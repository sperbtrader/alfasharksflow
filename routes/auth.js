const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const database = require('../database/init');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Validações
const registerValidation = [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Senha deve ter pelo menos 6 caracteres'),
    body('name').trim().isLength({ min: 2 }).withMessage('Nome deve ter pelo menos 2 caracteres')
];

const loginValidation = [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty().withMessage('Senha é obrigatória')
];

// Registro de usuário
router.post('/register', registerValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Dados inválidos',
                details: errors.array()
            });
        }

        const { email, password, name } = req.body;

        // Verificar se usuário já existe
        const existingUser = await database.get(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existingUser) {
            return res.status(409).json({
                error: 'Email já cadastrado'
            });
        }

        // Criptografar senha
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Criar usuário
        const result = await database.run(
            'INSERT INTO users (email, password, name, credits) VALUES (?, ?, ?, ?)',
            [email, hashedPassword, name, 5] // 5 créditos gratuitos
        );

        // Criar configurações padrão do usuário
        await database.run(
            'INSERT INTO user_settings (user_id) VALUES (?)',
            [result.id]
        );

        // Gerar token JWT
        const token = jwt.sign(
            { userId: result.id },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(201).json({
            message: 'Usuário criado com sucesso',
            token,
            user: {
                id: result.id,
                email,
                name,
                plan: 'free',
                credits: 5
            }
        });

    } catch (error) {
        console.error('Erro no registro:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Login
router.post('/login', loginValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Dados inválidos',
                details: errors.array()
            });
        }

        const { email, password } = req.body;

        // Buscar usuário
        const user = await database.get(
            'SELECT id, email, password, name, plan, credits FROM users WHERE email = ?',
            [email]
        );

        if (!user) {
            return res.status(401).json({
                error: 'Email ou senha incorretos'
            });
        }

        // Verificar senha
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({
                error: 'Email ou senha incorretos'
            });
        }

        // Gerar token JWT
        const token = jwt.sign(
            { userId: user.id },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        // Atualizar último login
        await database.run(
            'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );

        res.json({
            message: 'Login realizado com sucesso',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                plan: user.plan,
                credits: user.credits
            }
        });

    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Verificar token
router.get('/verify', authenticateToken, async (req, res) => {
    try {
        res.json({
            valid: true,
            user: req.user
        });
    } catch (error) {
        console.error('Erro na verificação:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Refresh token
router.post('/refresh', authenticateToken, async (req, res) => {
    try {
        // Gerar novo token
        const token = jwt.sign(
            { userId: req.user.id },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            message: 'Token atualizado com sucesso',
            token
        });

    } catch (error) {
        console.error('Erro no refresh:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Logout (invalidar token - em uma implementação real você manteria uma blacklist)
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        // Em uma implementação completa, você adicionaria o token a uma blacklist
        res.json({
            message: 'Logout realizado com sucesso'
        });
    } catch (error) {
        console.error('Erro no logout:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Alterar senha
router.post('/change-password', [
    authenticateToken,
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 6 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Dados inválidos',
                details: errors.array()
            });
        }

        const { currentPassword, newPassword } = req.body;

        // Buscar usuário completo
        const user = await database.get(
            'SELECT password FROM users WHERE id = ?',
            [req.user.id]
        );

        // Verificar senha atual
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
            return res.status(401).json({
                error: 'Senha atual incorreta'
            });
        }

        // Criptografar nova senha
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        // Atualizar senha
        await database.run(
            'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [hashedPassword, req.user.id]
        );

        res.json({
            message: 'Senha alterada com sucesso'
        });

    } catch (error) {
        console.error('Erro ao alterar senha:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

module.exports = router;