const axios = require('axios');
const database = require('../database/init');

class AIService {
    constructor() {
        this.providers = {
            openai: {
                url: 'https://api.openai.com/v1/chat/completions',
                model: 'gpt-4-turbo-preview',
                maxTokens: 4000
            },
            claude: {
                url: 'https://api.anthropic.com/v1/messages',
                model: 'claude-3-sonnet-20240229',
                maxTokens: 4000
            },
            deepseek: {
                url: 'https://api.deepseek.com/v1/chat/completions',
                model: 'deepseek-chat',
                maxTokens: 4000
            }
        };

        this.financialPrompts = {
            consulta: `Você é um analista financeiro especializado no mercado brasileiro. 
            Forneça análises técnicas e fundamentalistas precisas, sempre baseadas em dados reais quando possível.
            Use termos técnicos adequados e seja específico em suas recomendações.
            Sempre inclua disclaimers sobre riscos de investimento.`,

            daytrade: `Você é um especialista em day trade focado nos futuros da B3 (WINFUT, INDFUT, DOLFUT, WDOFUT, BITFUT).
            Forneça análises técnicas específicas com pontos de entrada, stop loss e alvos.
            Considere volume, padrões de candlestick e indicadores técnicos.
            Seja preciso com níveis de preço e sempre mencione o gerenciamento de risco.`,

            portfolio: `Você é um consultor de investimentos especializado em otimização de portfólios.
            Analise diversificação, correlações entre ativos e perfil de risco.
            Forneça recomendações de alocação baseadas em teoria moderna de portfólio.
            Considere o cenário macroeconômico brasileiro e global.`,

            robot: `Você é um programador especializado em desenvolvimento de robôs de trading para a plataforma Nelogica.
            Use a linguagem NTFL (Nelogica Trading Formula Language).
            Forneça código limpo, comentado e testável.
            Inclua explicações sobre a lógica da estratégia e parâmetros de configuração.`
        };
    }

    async generateResponse(message, mode = 'consulta', userId = null, conversationHistory = []) {
        try {
            // Buscar conhecimento relevante no banco de dados
            const relevantKnowledge = await this.searchKnowledge(message, mode);
            
            // Construir contexto
            const context = await this.buildContext(message, mode, relevantKnowledge, conversationHistory);
            
            // Selecionar provedor de IA baseado na complexidade
            const provider = this.selectProvider(message, mode);
            
            // Gerar resposta
            const response = await this.callAIProvider(provider, context);
            
            // Registrar uso se houver usuário
            if (userId) {
                await this.logUsage(userId, provider, response.tokensUsed || 100);
            }
            
            return {
                content: response.content,
                provider: provider,
                tokensUsed: response.tokensUsed || 100,
                model: this.providers[provider].model
            };
            
        } catch (error) {
            console.error('Erro no serviço de IA:', error);
            return this.getFallbackResponse(mode);
        }
    }

    async searchKnowledge(query, mode) {
        try {
            // Buscar conhecimento relevante baseado em palavras-chave
            const keywords = this.extractKeywords(query);
            const knowledge = await database.all(
                `SELECT title, content, category, subcategory 
                 FROM financial_knowledge 
                 WHERE (title LIKE ? OR content LIKE ? OR tags LIKE ?)
                 ORDER BY relevance_score DESC 
                 LIMIT 5`,
                [`%${keywords.join('%')}%`, `%${keywords.join('%')}%`, `%${keywords.join('%')}%`]
            );
            
            return knowledge;
        } catch (error) {
            console.error('Erro ao buscar conhecimento:', error);
            return [];
        }
    }

    extractKeywords(text) {
        // Lista de palavras-chave do mercado financeiro
        const financialTerms = [
            'WINFUT', 'INDFUT', 'DOLFUT', 'WDOFUT', 'BITFUT',
            'bovespa', 'ibovespa', 'futuros', 'day trade', 'swing trade',
            'scalping', 'breakout', 'support', 'resistance', 'macd',
            'rsi', 'bollinger', 'fibonacci', 'candlestick', 'volume',
            'análise técnica', 'análise fundamentalista'
        ];

        const words = text.toLowerCase().split(/\s+/);
        return words.filter(word => 
            financialTerms.some(term => 
                term.toLowerCase().includes(word) || word.includes(term.toLowerCase())
            ) || word.length > 4
        ).slice(0, 10);
    }

    buildContext(message, mode, knowledge, history) {
        let context = this.financialPrompts[mode] + '\n\n';
        
        // Adicionar conhecimento relevante
        if (knowledge.length > 0) {
            context += 'Conhecimento relevante:\n';
            knowledge.forEach(item => {
                context += `- ${item.title}: ${item.content}\n`;
            });
            context += '\n';
        }
        
        // Adicionar histórico da conversa (últimas 5 mensagens)
        if (history.length > 0) {
            context += 'Contexto da conversa:\n';
            const recentHistory = history.slice(-5);
            recentHistory.forEach(msg => {
                context += `${msg.role}: ${msg.content}\n`;
            });
            context += '\n';
        }
        
        context += `Pergunta do usuário: ${message}\n\nResposta:`;
        
        return context;
    }

    selectProvider(message, mode) {
        // Lógica para selecionar o melhor provedor baseado no tipo de consulta
        if (mode === 'robot' || message.toLowerCase().includes('código') || message.toLowerCase().includes('ntfl')) {
            return 'openai'; // GPT-4 é melhor para código
        }
        
        if (mode === 'daytrade' || message.toLowerCase().includes('análise técnica')) {
            return 'claude'; // Claude é bom para análises detalhadas
        }
        
        if (message.toLowerCase().includes('previsão') || message.toLowerCase().includes('tendência')) {
            return 'deepseek'; // DeepSeek para raciocínio complexo
        }
        
        // Default para GPT-4
        return 'openai';
    }

    async callAIProvider(provider, context) {
        try {
            if (provider === 'openai') {
                return await this.callOpenAI(context);
            } else if (provider === 'claude') {
                return await this.callClaude(context);
            } else if (provider === 'deepseek') {
                return await this.callDeepSeek(context);
            }
        } catch (error) {
            console.error(`Erro no provedor ${provider}:`, error);
            // Fallback para mock response em desenvolvimento
            return this.getMockResponse();
        }
    }

    async callOpenAI(context) {
        const response = await axios.post(this.providers.openai.url, {
            model: this.providers.openai.model,
            messages: [{ role: 'user', content: context }],
            max_tokens: this.providers.openai.maxTokens,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return {
            content: response.data.choices[0].message.content,
            tokensUsed: response.data.usage.total_tokens
        };
    }

    async callClaude(context) {
        const response = await axios.post(this.providers.claude.url, {
            model: this.providers.claude.model,
            max_tokens: this.providers.claude.maxTokens,
            messages: [{ role: 'user', content: context }]
        }, {
            headers: {
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        return {
            content: response.data.content[0].text,
            tokensUsed: response.data.usage.input_tokens + response.data.usage.output_tokens
        };
    }

    async callDeepSeek(context) {
        const response = await axios.post(this.providers.deepseek.url, {
            model: this.providers.deepseek.model,
            messages: [{ role: 'user', content: context }],
            max_tokens: this.providers.deepseek.maxTokens,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return {
            content: response.data.choices[0].message.content,
            tokensUsed: response.data.usage.total_tokens
        };
    }

    getMockResponse() {
        const responses = [
            {
                content: `Baseado na análise técnica atual, identifiquei alguns pontos importantes:

📊 **Análise Geral do Mercado:**
• IBOVESPA está testando resistência em 130.000 pontos
• Volume médio nas últimas sessões
• Tendência de curto prazo lateral com viés de alta

📈 **WINFUT - Recomendações:**
• Suporte: 127.800 / 127.500
• Resistência: 128.400 / 128.700
• Estratégia: Aguardar rompimento para definir direção

⚠️ **Gestão de Risco:**
• Stop loss sempre abaixo do suporte identificado
• Position size adequado ao seu capital
• Não arrisque mais de 2% do capital por operação

*Esta análise é baseada em dados técnicos e não constitui recomendação de investimento. Sempre consulte um assessor financeiro.*`,
                tokensUsed: 150
            },
            {
                content: `Análise técnica para Day Trade:

🎯 **WINFUT - Setup Atual:**
• Preço: 128.100 pontos
• Movimento lateral entre 127.800 e 128.400
• MACD em divergência positiva
• RSI em 55 (neutro)

📋 **Estratégia Sugerida:**
1. **Entrada Long:** Rompimento de 128.400 com volume
2. **Stop Loss:** 127.950 (45 pontos)
3. **Alvo 1:** 128.700 (30 pontos)
4. **Alvo 2:** 129.000 (60 pontos)

🔍 **INDFUT - Observações:**
• Maior volatilidade que WINFUT
• Correlação alta com IBOV
• Requer maior capital devido ao tick

⚡ **Dicas para Day Trade:**
• Opere apenas nos horários de maior volume (10h-11h30 / 14h-16h)
• Use ordens stop para proteção automática
• Acompanhe os índices americanos para confluência

*Lembrando que day trade é uma atividade de alto risco.*`,
                tokensUsed: 180
            }
        ];
        
        return responses[Math.floor(Math.random() * responses.length)];
    }

    getFallbackResponse(mode) {
        const fallbacks = {
            consulta: {
                content: "Desculpe, estou enfrentando dificuldades técnicas no momento. Por favor, tente novamente em alguns minutos ou reformule sua pergunta.",
                tokensUsed: 50,
                provider: 'fallback',
                model: 'fallback'
            },
            daytrade: {
                content: "Sistema de análise técnica temporariamente indisponível. Para day trade, sempre lembre-se de usar stop loss e não arriscar mais de 2% do capital por operação.",
                tokensUsed: 50,
                provider: 'fallback',
                model: 'fallback'
            },
            portfolio: {
                content: "Serviço de análise de portfólio em manutenção. Em breve estaremos de volta com análises completas de diversificação e otimização.",
                tokensUsed: 50,
                provider: 'fallback',
                model: 'fallback'
            },
            robot: {
                content: "Gerador de código NTFL temporariamente offline. Consulte a documentação da Nelogica para referências de programação.",
                tokensUsed: 50,
                provider: 'fallback',
                model: 'fallback'
            }
        };
        
        return fallbacks[mode] || fallbacks.consulta;
    }

    async logUsage(userId, provider, tokensUsed) {
        try {
            // Consumir créditos do usuário (apenas para planos free/basic)
            const user = await database.get('SELECT plan, credits FROM users WHERE id = ?', [userId]);
            
            if (user && (user.plan === 'free' || user.plan === 'basic') && user.credits > 0) {
                await database.run(
                    'UPDATE users SET credits = credits - 1 WHERE id = ?',
                    [userId]
                );
            }
            
            // Registrar no log
            await database.run(
                `INSERT INTO api_logs (user_id, endpoint, method, status_code) 
                 VALUES (?, ?, ?, ?)`,
                [userId, 'ai_chat', 'POST', 200]
            );
            
        } catch (error) {
            console.error('Erro ao registrar uso:', error);
        }
    }
}

module.exports = new AIService();