const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor() {
        this.dbPath = process.env.DB_PATH || './database/sharkmind.db';
        this.db = null;
    }

    async init() {
        // Criar diretório do banco se não existir
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log('Conectado ao banco SQLite');
                    this.createTables().then(resolve).catch(reject);
                }
            });
        });
    }

    async createTables() {
        const tables = [
            // Tabela de usuários
            `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                plan TEXT DEFAULT 'free',
                credits INTEGER DEFAULT 5,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Tabela de conversas
            `CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'consulta',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,

            // Tabela de mensagens
            `CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                tokens_used INTEGER DEFAULT 0,
                model_used TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations (id)
            )`,

            // Tabela de transações
            `CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('credit_purchase', 'plan_upgrade', 'usage')),
                amount DECIMAL(10,2) NOT NULL,
                credits INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                stripe_payment_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,

            // Tabela de conhecimento financeiro
            `CREATE TABLE IF NOT EXISTS financial_knowledge (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                subcategory TEXT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                tags TEXT,
                source TEXT,
                relevance_score REAL DEFAULT 1.0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Tabela de dados de mercado em cache
            `CREATE TABLE IF NOT EXISTS market_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                data_type TEXT NOT NULL,
                data TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL
            )`,

            // Tabela de logs de API
            `CREATE TABLE IF NOT EXISTS api_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                endpoint TEXT NOT NULL,
                method TEXT NOT NULL,
                status_code INTEGER NOT NULL,
                response_time INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,

            // Tabela de configurações do usuário
            `CREATE TABLE IF NOT EXISTS user_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                preferred_assets TEXT DEFAULT '["WINFUT", "INDFUT", "DOLFUT"]',
                risk_tolerance TEXT DEFAULT 'medium',
                trading_style TEXT DEFAULT 'day_trade',
                notifications_enabled BOOLEAN DEFAULT 1,
                theme TEXT DEFAULT 'dark',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`
        ];

        return Promise.all(tables.map(sql => this.run(sql)));
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    // Inserir dados iniciais de conhecimento financeiro
    async seedFinancialKnowledge() {
        const knowledgeData = [
            {
                category: 'Futuros',
                subcategory: 'WINFUT',
                title: 'Mini Índice Bovespa Futuro',
                content: 'O WINFUT é o contrato futuro do mini índice Bovespa, cada ponto vale R$ 0,20. É o ativo mais líquido para day trade no Brasil.',
                tags: 'winfut,ibovespa,day trade,futuros',
                source: 'B3'
            },
            {
                category: 'Futuros',
                subcategory: 'INDFUT',
                title: 'Índice Bovespa Futuro',
                content: 'O INDFUT é o contrato futuro do índice Bovespa, cada ponto vale R$ 1,00. Indicado para operações com maior capital.',
                tags: 'indfut,ibovespa,futuros',
                source: 'B3'
            },
            {
                category: 'Futuros',
                subcategory: 'DOLFUT',
                title: 'Dólar Futuro',
                content: 'O DOLFUT é o contrato futuro do dólar americano, cada ponto vale R$ 50,00. Muito usado para hedge cambial.',
                tags: 'dolfut,dolar,cambio,hedge',
                source: 'B3'
            },
            {
                category: 'Estratégias',
                subcategory: 'Scalping',
                title: 'Estratégia de Scalping',
                content: 'Scalping é uma estratégia de trading que busca lucros pequenos em operações muito rápidas, geralmente durando segundos ou minutos.',
                tags: 'scalping,day trade,estrategia',
                source: 'SharkMind AI'
            },
            {
                category: 'Indicadores',
                subcategory: 'MACD',
                title: 'Moving Average Convergence Divergence',
                content: 'O MACD é um indicador de momentum que mostra a relação entre duas médias móveis do preço de um ativo.',
                tags: 'macd,indicador,analise tecnica',
                source: 'Análise Técnica'
            }
        ];

        for (const item of knowledgeData) {
            const exists = await this.get(
                'SELECT id FROM financial_knowledge WHERE title = ?',
                [item.title]
            );

            if (!exists) {
                await this.run(
                    `INSERT INTO financial_knowledge 
                     (category, subcategory, title, content, tags, source) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [item.category, item.subcategory, item.title, item.content, item.tags, item.source]
                );
            }
        }
    }
}

const database = new Database();

module.exports = database;