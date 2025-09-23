const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const paymentRoutes = require('./routes/payments');
const userRoutes = require('./routes/user');
const marketRoutes = require('./routes/market');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de segurança
app.use(helmet({
    contentSecurityPolicy: false, // Desabilitado para desenvolvimento
}));

app.use(compression());
app.use(morgan('combined'));

// CORS
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://sharkmindai.com'] 
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // máximo 100 requests por IP por janela
    message: {
        error: 'Muitas requisições. Tente novamente em 15 minutos.'
    }
});

const chatLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 10, // máximo 10 mensagens por minuto
    message: {
        error: 'Muitas mensagens enviadas. Aguarde um momento.'
    }
});

app.use(limiter);

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname)));

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatLimiter, chatRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/user', userRoutes);
app.use('/api/market', marketRoutes);

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota do chat
app.get('/chat-ia', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat-ia.html'));
});

// Middleware de tratamento de erros
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: 'Erro interno do servidor',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Algo deu errado'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint não encontrado'
    });
});

// Inicializar banco de dados
const Database = require('./database/init');
Database.init().then(() => {
    console.log('📊 Banco de dados inicializado com sucesso');
    
    app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
        console.log(`📱 Chat IA: http://localhost:${PORT}/chat-ia`);
        console.log(`🌐 Site principal: http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('❌ Erro ao inicializar banco de dados:', err);
    process.exit(1);
});

module.exports = app;