const express = require('express');
const axios = require('axios');
const database = require('../database/init');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Cache de dados de mercado (em produção, use Redis)
const marketCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

// Dados simulados para desenvolvimento
const MOCK_MARKET_DATA = {
    WINFUT: {
        symbol: 'WINFUT',
        price: 128150,
        change: 450,
        changePercent: 0.35,
        volume: 1250000,
        high: 128400,
        low: 127800,
        open: 127950,
        timestamp: new Date().toISOString()
    },
    INDFUT: {
        symbol: 'INDFUT',
        price: 128580,
        change: 380,
        changePercent: 0.30,
        volume: 850000,
        high: 128900,
        low: 128200,
        open: 128200,
        timestamp: new Date().toISOString()
    },
    DOLFUT: {
        symbol: 'DOLFUT',
        price: 5.1580,
        change: -0.0120,
        changePercent: -0.23,
        volume: 2100000,
        high: 5.1720,
        low: 5.1480,
        open: 5.1700,
        timestamp: new Date().toISOString()
    },
    WDOFUT: {
        symbol: 'WDOFUT',
        price: 51580,
        change: -120,
        changePercent: -0.23,
        volume: 780000,
        high: 51720,
        low: 51480,
        open: 51700,
        timestamp: new Date().toISOString()
    },
    BITFUT: {
        symbol: 'BITFUT',
        price: 385250,
        change: 8450,
        changePercent: 2.24,
        volume: 450000,
        high: 387200,
        low: 376800,
        open: 376800,
        timestamp: new Date().toISOString()
    },
    IBOV: {
        symbol: 'IBOV',
        price: 130250,
        change: 850,
        changePercent: 0.66,
        volume: 15600000,
        high: 130450,
        low: 129800,
        open: 129400,
        timestamp: new Date().toISOString()
    }
};

// Buscar dados de mercado em tempo real
router.get('/quotes/:symbol', optionalAuth, async (req, res) => {
    try {
        const { symbol } = req.params;
        const upperSymbol = symbol.toUpperCase();

        // Verificar cache primeiro
        const cacheKey = `quote_${upperSymbol}`;
        const cached = marketCache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
            return res.json(cached.data);
        }

        // Buscar dados reais ou usar mock
        let marketData;
        
        if (process.env.NODE_ENV === 'production') {
            marketData = await fetchRealMarketData(upperSymbol);
        } else {
            marketData = MOCK_MARKET_DATA[upperSymbol];
        }

        if (!marketData) {
            return res.status(404).json({
                error: 'Símbolo não encontrado'
            });
        }

        // Salvar no cache
        marketCache.set(cacheKey, {
            data: marketData,
            timestamp: Date.now()
        });

        // Salvar no banco para histórico
        await saveMarketDataToDb(upperSymbol, marketData);

        res.json(marketData);

    } catch (error) {
        console.error('Erro ao buscar cotação:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Buscar múltiplas cotações
router.get('/quotes', optionalAuth, async (req, res) => {
    try {
        const symbols = req.query.symbols?.split(',') || Object.keys(MOCK_MARKET_DATA);
        const quotes = {};

        for (const symbol of symbols) {
            const upperSymbol = symbol.toUpperCase();
            
            // Verificar cache
            const cacheKey = `quote_${upperSymbol}`;
            const cached = marketCache.get(cacheKey);
            
            if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
                quotes[upperSymbol] = cached.data;
            } else {
                // Buscar dados
                let marketData;
                
                if (process.env.NODE_ENV === 'production') {
                    marketData = await fetchRealMarketData(upperSymbol);
                } else {
                    marketData = MOCK_MARKET_DATA[upperSymbol];
                }

                if (marketData) {
                    quotes[upperSymbol] = marketData;
                    
                    // Cache
                    marketCache.set(cacheKey, {
                        data: marketData,
                        timestamp: Date.now()
                    });
                    
                    // Salvar no banco
                    await saveMarketDataToDb(upperSymbol, marketData);
                }
            }
        }

        res.json({ quotes });

    } catch (error) {
        console.error('Erro ao buscar múltiplas cotações:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Buscar dados históricos
router.get('/history/:symbol', optionalAuth, async (req, res) => {
    try {
        const { symbol } = req.params;
        const { period = '1d', interval = '5m' } = req.query;

        // Em desenvolvimento, retornar dados simulados
        if (process.env.NODE_ENV !== 'production') {
            const historicalData = generateMockHistoricalData(symbol.toUpperCase(), period, interval);
            return res.json(historicalData);
        }

        // Em produção, buscar dados reais
        const historicalData = await fetchHistoricalData(symbol.toUpperCase(), period, interval);
        
        res.json(historicalData);

    } catch (error) {
        console.error('Erro ao buscar dados históricos:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Indicadores técnicos
router.get('/indicators/:symbol', optionalAuth, async (req, res) => {
    try {
        const { symbol } = req.params;
        const { indicators = 'sma,ema,rsi,macd' } = req.query;

        const indicatorList = indicators.split(',');
        const calculatedIndicators = {};

        // Buscar dados históricos
        const historicalData = await getHistoricalDataForCalculations(symbol.toUpperCase());

        for (const indicator of indicatorList) {
            switch (indicator.toLowerCase()) {
                case 'sma':
                    calculatedIndicators.sma = calculateSMA(historicalData, 20);
                    break;
                case 'ema':
                    calculatedIndicators.ema = calculateEMA(historicalData, 20);
                    break;
                case 'rsi':
                    calculatedIndicators.rsi = calculateRSI(historicalData, 14);
                    break;
                case 'macd':
                    calculatedIndicators.macd = calculateMACD(historicalData);
                    break;
                case 'bollinger':
                    calculatedIndicators.bollinger = calculateBollingerBands(historicalData, 20, 2);
                    break;
            }
        }

        res.json({
            symbol: symbol.toUpperCase(),
            indicators: calculatedIndicators,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Erro ao calcular indicadores:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Análise técnica automática
router.get('/analysis/:symbol', optionalAuth, async (req, res) => {
    try {
        const { symbol } = req.params;
        const upperSymbol = symbol.toUpperCase();

        // Buscar dados atuais e indicadores
        const currentData = MOCK_MARKET_DATA[upperSymbol];
        const indicators = {
            rsi: 58.5,
            macd: { macd: 45.2, signal: 42.1, histogram: 3.1 },
            sma20: 127800,
            ema20: 127950,
            bollinger: { upper: 128500, middle: 128000, lower: 127500 }
        };

        // Gerar análise técnica
        const analysis = generateTechnicalAnalysis(currentData, indicators);

        res.json({
            symbol: upperSymbol,
            analysis,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Erro ao gerar análise:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Watchlist personalizada
router.get('/watchlist', optionalAuth, async (req, res) => {
    try {
        let symbols = ['WINFUT', 'INDFUT', 'DOLFUT']; // Default

        if (req.user) {
            const userSettings = await database.get(
                'SELECT preferred_assets FROM user_settings WHERE user_id = ?',
                [req.user.id]
            );

            if (userSettings?.preferred_assets) {
                try {
                    symbols = JSON.parse(userSettings.preferred_assets);
                } catch (e) {
                    console.error('Erro ao parsear ativos preferidos:', e);
                }
            }
        }

        const watchlistData = {};
        for (const symbol of symbols) {
            watchlistData[symbol] = MOCK_MARKET_DATA[symbol] || null;
        }

        res.json({
            watchlist: watchlistData,
            symbols
        });

    } catch (error) {
        console.error('Erro ao buscar watchlist:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Funções auxiliares

async function fetchRealMarketData(symbol) {
    // Implementar integração com APIs reais (B3, Yahoo Finance, Alpha Vantage, etc.)
    try {
        // Exemplo com Alpha Vantage
        const response = await axios.get(`https://www.alphavantage.co/query`, {
            params: {
                function: 'GLOBAL_QUOTE',
                symbol: symbol,
                apikey: process.env.ALPHA_VANTAGE_API_KEY
            }
        });

        // Processar resposta e converter para formato padrão
        return processAlphaVantageData(response.data);
    } catch (error) {
        console.error('Erro ao buscar dados reais:', error);
        return null;
    }
}

function generateMockHistoricalData(symbol, period, interval) {
    const data = [];
    const basePrice = MOCK_MARKET_DATA[symbol]?.price || 128000;
    
    let dataPoints;
    switch (period) {
        case '1d': dataPoints = 78; break; // 1 dia, 5min intervals
        case '5d': dataPoints = 390; break;
        case '1m': dataPoints = 1560; break;
        default: dataPoints = 78;
    }

    for (let i = dataPoints; i > 0; i--) {
        const timestamp = new Date(Date.now() - (i * 5 * 60 * 1000));
        const volatility = Math.random() * 0.02 - 0.01; // -1% a +1%
        const price = basePrice * (1 + volatility);
        
        data.push({
            timestamp: timestamp.toISOString(),
            open: price * (1 + (Math.random() * 0.005 - 0.0025)),
            high: price * (1 + Math.random() * 0.005),
            low: price * (1 - Math.random() * 0.005),
            close: price,
            volume: Math.floor(Math.random() * 100000) + 50000
        });
    }

    return {
        symbol,
        period,
        interval,
        data
    };
}

async function saveMarketDataToDb(symbol, data) {
    try {
        await database.run(
            `INSERT OR REPLACE INTO market_data (symbol, data_type, data, expires_at) 
             VALUES (?, ?, ?, datetime('now', '+5 minutes'))`,
            [symbol, 'quote', JSON.stringify(data)]
        );
    } catch (error) {
        console.error('Erro ao salvar dados no banco:', error);
    }
}

function calculateSMA(data, period) {
    // Implementar cálculo de Média Móvel Simples
    const prices = data.slice(-period).map(d => d.close);
    const sum = prices.reduce((a, b) => a + b, 0);
    return sum / prices.length;
}

function calculateEMA(data, period) {
    // Implementar cálculo de Média Móvel Exponencial
    const multiplier = 2 / (period + 1);
    let ema = data[0].close;
    
    for (let i = 1; i < data.length; i++) {
        ema = (data[i].close * multiplier) + (ema * (1 - multiplier));
    }
    
    return ema;
}

function calculateRSI(data, period = 14) {
    // Implementar cálculo do RSI
    if (data.length < period + 1) return 50; // Valor neutro se não há dados suficientes
    
    const changes = [];
    for (let i = 1; i < data.length; i++) {
        changes.push(data[i].close - data[i-1].close);
    }
    
    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? -c : 0);
    
    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateMACD(data) {
    // Implementar cálculo do MACD
    const ema12 = calculateEMA(data.slice(-12), 12);
    const ema26 = calculateEMA(data.slice(-26), 26);
    const macd = ema12 - ema26;
    
    // Signal line seria EMA do MACD, simplificando aqui
    const signal = macd * 0.9; // Aproximação
    const histogram = macd - signal;
    
    return { macd, signal, histogram };
}

function calculateBollingerBands(data, period = 20, deviation = 2) {
    const sma = calculateSMA(data, period);
    const prices = data.slice(-period).map(d => d.close);
    
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    
    return {
        upper: sma + (stdDev * deviation),
        middle: sma,
        lower: sma - (stdDev * deviation)
    };
}

function generateTechnicalAnalysis(currentData, indicators) {
    const analysis = {
        trend: 'neutral',
        strength: 'moderate',
        signals: [],
        support: [],
        resistance: [],
        recommendation: 'hold'
    };

    if (!currentData) return analysis;

    // Análise de tendência
    if (currentData.price > indicators.sma20 && currentData.price > indicators.ema20) {
        analysis.trend = 'bullish';
        analysis.signals.push('Preço acima das médias móveis - sinal de alta');
    } else if (currentData.price < indicators.sma20 && currentData.price < indicators.ema20) {
        analysis.trend = 'bearish';
        analysis.signals.push('Preço abaixo das médias móveis - sinal de baixa');
    }

    // Análise de RSI
    if (indicators.rsi > 70) {
        analysis.signals.push('RSI em sobrecompra - possível correção');
        analysis.recommendation = 'sell';
    } else if (indicators.rsi < 30) {
        analysis.signals.push('RSI em sobrevenda - possível recuperação');
        analysis.recommendation = 'buy';
    }

    // Análise de MACD
    if (indicators.macd.macd > indicators.macd.signal) {
        analysis.signals.push('MACD positivo - momentum de alta');
    } else {
        analysis.signals.push('MACD negativo - momentum de baixa');
    }

    // Suporte e resistência (Bollinger Bands)
    analysis.support.push(indicators.bollinger.lower);
    analysis.resistance.push(indicators.bollinger.upper);

    return analysis;
}

async function getHistoricalDataForCalculations(symbol) {
    // Retornar dados históricos simulados para cálculos
    return generateMockHistoricalData(symbol, '1d', '5m').data;
}

module.exports = router;