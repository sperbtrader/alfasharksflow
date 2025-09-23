const jwt = require('jsonwebtoken');
const database = require('../database/init');

// Middleware para verificar JWT token
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Token de acesso requerido' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await database.get(
            'SELECT id, email, name, plan, credits FROM users WHERE id = ?',
            [decoded.userId]
        );

        if (!user) {
            return res.status(403).json({ error: 'Token inválido' });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Erro na autenticação:', error);
        return res.status(403).json({ error: 'Token inválido' });
    }
};

// Middleware para verificar se o usuário tem créditos suficientes
const checkCredits = (requiredCredits = 1) => {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuário não autenticado' });
        }

        // Usuários premium têm créditos ilimitados
        if (req.user.plan === 'premium' || req.user.plan === 'unlimited') {
            return next();
        }

        if (req.user.credits < requiredCredits) {
            return res.status(402).json({ 
                error: 'Créditos insuficientes',
                credits: req.user.credits,
                required: requiredCredits
            });
        }

        next();
    };
};

// Middleware para verificar plano do usuário
const checkPlan = (requiredPlan) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Usuário não autenticado' });
        }

        const planHierarchy = {
            'free': 1,
            'basic': 2,
            'premium': 3,
            'unlimited': 4
        };

        const userPlanLevel = planHierarchy[req.user.plan] || 0;
        const requiredPlanLevel = planHierarchy[requiredPlan] || 0;

        if (userPlanLevel < requiredPlanLevel) {
            return res.status(403).json({ 
                error: 'Plano insuficiente',
                currentPlan: req.user.plan,
                requiredPlan: requiredPlan
            });
        }

        next();
    };
};

// Middleware opcional - não requer autenticação, mas carrega o usuário se existir
const optionalAuth = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await database.get(
                'SELECT id, email, name, plan, credits FROM users WHERE id = ?',
                [decoded.userId]
            );
            
            if (user) {
                req.user = user;
            }
        } catch (error) {
            // Token inválido, mas não bloqueia a requisição
            console.log('Token inválido (modo opcional):', error.message);
        }
    }

    next();
};

module.exports = {
    authenticateToken,
    checkCredits,
    checkPlan,
    optionalAuth
};