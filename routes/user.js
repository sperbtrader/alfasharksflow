const express = require('express');
const { body, validationResult } = require('express-validator');
const database = require('../database/init');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Buscar perfil do usuário
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const user = await database.get(
            `SELECT u.id, u.email, u.name, u.plan, u.credits, u.created_at, u.updated_at,
                    s.preferred_assets, s.risk_tolerance, s.trading_style, s.notifications_enabled, s.theme
             FROM users u
             LEFT JOIN user_settings s ON s.user_id = u.id
             WHERE u.id = ?`,
            [req.user.id]
        );

        if (!user) {
            return res.status(404).json({
                error: 'Usuário não encontrado'
            });
        }

        // Parse do JSON de ativos preferidos
        if (user.preferred_assets) {
            try {
                user.preferred_assets = JSON.parse(user.preferred_assets);
            } catch (e) {
                user.preferred_assets = ["WINFUT", "INDFUT", "DOLFUT"];
            }
        }

        res.json({
            user
        });

    } catch (error) {
        console.error('Erro ao buscar perfil:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Atualizar perfil do usuário
router.put('/profile', [
    authenticateToken,
    body('name').optional().trim().isLength({ min: 2 }),
    body('preferred_assets').optional().isArray(),
    body('risk_tolerance').optional().isIn(['low', 'medium', 'high']),
    body('trading_style').optional().isIn(['day_trade', 'swing_trade', 'position_trade']),
    body('notifications_enabled').optional().isBoolean(),
    body('theme').optional().isIn(['light', 'dark'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Dados inválidos',
                details: errors.array()
            });
        }

        const { name, preferred_assets, risk_tolerance, trading_style, notifications_enabled, theme } = req.body;

        // Atualizar dados básicos do usuário
        if (name) {
            await database.run(
                'UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [name, req.user.id]
            );
        }

        // Atualizar configurações do usuário
        const settingsUpdates = [];
        const settingsValues = [];

        if (preferred_assets !== undefined) {
            settingsUpdates.push('preferred_assets = ?');
            settingsValues.push(JSON.stringify(preferred_assets));
        }
        
        if (risk_tolerance !== undefined) {
            settingsUpdates.push('risk_tolerance = ?');
            settingsValues.push(risk_tolerance);
        }
        
        if (trading_style !== undefined) {
            settingsUpdates.push('trading_style = ?');
            settingsValues.push(trading_style);
        }
        
        if (notifications_enabled !== undefined) {
            settingsUpdates.push('notifications_enabled = ?');
            settingsValues.push(notifications_enabled ? 1 : 0);
        }
        
        if (theme !== undefined) {
            settingsUpdates.push('theme = ?');
            settingsValues.push(theme);
        }

        if (settingsUpdates.length > 0) {
            settingsValues.push(req.user.id);
            await database.run(
                `UPDATE user_settings SET ${settingsUpdates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
                settingsValues
            );
        }

        res.json({
            message: 'Perfil atualizado com sucesso'
        });

    } catch (error) {
        console.error('Erro ao atualizar perfil:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Buscar histórico de transações
router.get('/transactions', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;

        const transactions = await database.all(
            `SELECT id, type, amount, credits, status, created_at 
             FROM transactions 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT ? OFFSET ?`,
            [req.user.id, limit, offset]
        );

        const totalTransactions = await database.get(
            'SELECT COUNT(*) as total FROM transactions WHERE user_id = ?',
            [req.user.id]
        );

        res.json({
            transactions,
            pagination: {
                page,
                limit,
                total: totalTransactions.total,
                pages: Math.ceil(totalTransactions.total / limit)
            }
        });

    } catch (error) {
        console.error('Erro ao buscar transações:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Buscar estatísticas detalhadas do usuário
router.get('/analytics', authenticateToken, async (req, res) => {
    try {
        // Estatísticas gerais
        const generalStats = await database.get(
            `SELECT 
                COUNT(DISTINCT c.id) as totalConversations,
                COUNT(CASE WHEN m.role = 'user' THEN 1 END) as totalMessages,
                SUM(m.tokens_used) as totalTokens,
                (5 - u.credits) as creditsUsed
             FROM users u
             LEFT JOIN conversations c ON c.user_id = u.id
             LEFT JOIN messages m ON m.conversation_id = c.id
             WHERE u.id = ?`,
            [req.user.id]
        );

        // Estatísticas por modo
        const modeStats = await database.all(
            `SELECT 
                c.mode,
                COUNT(DISTINCT c.id) as conversations,
                COUNT(CASE WHEN m.role = 'user' THEN 1 END) as messages
             FROM conversations c
             LEFT JOIN messages m ON m.conversation_id = c.id
             WHERE c.user_id = ?
             GROUP BY c.mode`,
            [req.user.id]
        );

        // Atividade dos últimos 7 dias
        const recentActivity = await database.all(
            `SELECT 
                DATE(c.created_at) as date,
                COUNT(*) as conversations
             FROM conversations c
             WHERE c.user_id = ? AND c.created_at >= date('now', '-7 days')
             GROUP BY DATE(c.created_at)
             ORDER BY date`,
            [req.user.id]
        );

        // Modelos de IA mais usados
        const modelUsage = await database.all(
            `SELECT 
                m.model_used,
                COUNT(*) as usage_count,
                SUM(m.tokens_used) as total_tokens
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             WHERE c.user_id = ? AND m.model_used IS NOT NULL
             GROUP BY m.model_used
             ORDER BY usage_count DESC`,
            [req.user.id]
        );

        res.json({
            general: generalStats,
            byMode: modeStats,
            recentActivity,
            modelUsage
        });

    } catch (error) {
        console.error('Erro ao buscar analytics:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Excluir conta do usuário
router.delete('/account', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Deletar em cascata (devido às foreign keys)
        await database.run('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)', [userId]);
        await database.run('DELETE FROM conversations WHERE user_id = ?', [userId]);
        await database.run('DELETE FROM transactions WHERE user_id = ?', [userId]);
        await database.run('DELETE FROM user_settings WHERE user_id = ?', [userId]);
        await database.run('DELETE FROM api_logs WHERE user_id = ?', [userId]);
        await database.run('DELETE FROM users WHERE id = ?', [userId]);

        res.json({
            message: 'Conta excluída com sucesso'
        });

    } catch (error) {
        console.error('Erro ao excluir conta:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Exportar dados do usuário (LGPD compliance)
router.get('/export', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Buscar todos os dados do usuário
        const userData = await database.get(
            'SELECT id, email, name, plan, credits, created_at, updated_at FROM users WHERE id = ?',
            [userId]
        );

        const userSettings = await database.get(
            'SELECT * FROM user_settings WHERE user_id = ?',
            [userId]
        );

        const conversations = await database.all(
            'SELECT * FROM conversations WHERE user_id = ?',
            [userId]
        );

        const messages = await database.all(
            `SELECT m.* FROM messages m 
             JOIN conversations c ON c.id = m.conversation_id 
             WHERE c.user_id = ?`,
            [userId]
        );

        const transactions = await database.all(
            'SELECT * FROM transactions WHERE user_id = ?',
            [userId]
        );

        res.json({
            exportDate: new Date().toISOString(),
            userData,
            userSettings,
            conversations,
            messages,
            transactions
        });

    } catch (error) {
        console.error('Erro ao exportar dados:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Buscar créditos atuais
router.get('/credits', authenticateToken, async (req, res) => {
    try {
        const user = await database.get(
            'SELECT credits, plan FROM users WHERE id = ?',
            [req.user.id]
        );

        res.json({
            credits: user.credits,
            plan: user.plan,
            unlimited: user.plan === 'premium' || user.plan === 'unlimited'
        });

    } catch (error) {
        console.error('Erro ao buscar créditos:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

module.exports = router;