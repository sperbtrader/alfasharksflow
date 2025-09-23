const express = require('express');
const { body, validationResult } = require('express-validator');
const database = require('../database/init');
const { optionalAuth, checkCredits } = require('../middleware/auth');
const aiService = require('../services/aiService');

const router = express.Router();

// Validações
const messageValidation = [
    body('message').trim().isLength({ min: 1, max: 2000 }).withMessage('Mensagem deve ter entre 1 e 2000 caracteres'),
    body('mode').isIn(['consulta', 'daytrade', 'portfolio', 'robot']).withMessage('Modo inválido'),
    body('conversationId').optional().isInt().withMessage('ID da conversa inválido')
];

// Enviar mensagem para o chat
router.post('/message', [optionalAuth, messageValidation], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Dados inválidos',
                details: errors.array()
            });
        }

        const { message, mode, conversationId } = req.body;
        const userId = req.user?.id;

        // Verificar créditos para usuários autenticados
        if (userId) {
            const user = await database.get('SELECT credits, plan FROM users WHERE id = ?', [userId]);
            if (user && (user.plan === 'free' || user.plan === 'basic') && user.credits <= 0) {
                return res.status(402).json({
                    error: 'Créditos insuficientes',
                    credits: 0
                });
            }
        } else {
            // Usuários não autenticados têm limite básico (simulado via session)
            // Em produção, você implementaria rate limiting por IP
        }

        // Buscar ou criar conversa
        let conversation;
        if (conversationId && userId) {
            conversation = await database.get(
                'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
                [conversationId, userId]
            );
        }

        if (!conversation && userId) {
            // Criar nova conversa
            const title = message.length > 50 ? message.substring(0, 50) + '...' : message;
            const result = await database.run(
                'INSERT INTO conversations (user_id, title, mode) VALUES (?, ?, ?)',
                [userId, title, mode]
            );
            
            conversation = {
                id: result.id,
                user_id: userId,
                title,
                mode
            };
        }

        // Buscar histórico da conversa
        let conversationHistory = [];
        if (conversation) {
            conversationHistory = await database.all(
                'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
                [conversation.id]
            );
        }

        // Salvar mensagem do usuário
        if (conversation) {
            await database.run(
                'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
                [conversation.id, 'user', message]
            );
        }

        // Gerar resposta da IA
        const aiResponse = await aiService.generateResponse(
            message, 
            mode, 
            userId, 
            conversationHistory
        );

        // Salvar resposta da IA
        if (conversation) {
            await database.run(
                'INSERT INTO messages (conversation_id, role, content, tokens_used, model_used) VALUES (?, ?, ?, ?, ?)',
                [conversation.id, 'assistant', aiResponse.content, aiResponse.tokensUsed, aiResponse.model]
            );
        }

        // Atualizar créditos do usuário
        let updatedCredits = null;
        if (userId) {
            const user = await database.get('SELECT credits, plan FROM users WHERE id = ?', [userId]);
            if (user && (user.plan === 'free' || user.plan === 'basic') && user.credits > 0) {
                await database.run('UPDATE users SET credits = credits - 1 WHERE id = ?', [userId]);
                updatedCredits = user.credits - 1;
            } else if (user) {
                updatedCredits = user.credits;
            }
        }

        res.json({
            message: 'Resposta gerada com sucesso',
            response: aiResponse.content,
            conversationId: conversation?.id,
            credits: updatedCredits,
            tokensUsed: aiResponse.tokensUsed,
            model: aiResponse.model
        });

    } catch (error) {
        console.error('Erro ao processar mensagem:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Buscar conversas do usuário
router.get('/conversations', optionalAuth, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                error: 'Usuário não autenticado'
            });
        }

        const conversations = await database.all(
            `SELECT c.id, c.title, c.mode, c.created_at, c.updated_at,
                    (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
             FROM conversations c 
             WHERE c.user_id = ? 
             ORDER BY c.updated_at DESC 
             LIMIT 20`,
            [req.user.id]
        );

        res.json({
            conversations
        });

    } catch (error) {
        console.error('Erro ao buscar conversas:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Buscar mensagens de uma conversa
router.get('/conversations/:conversationId/messages', optionalAuth, async (req, res) => {
    try {
        const { conversationId } = req.params;
        
        if (!req.user) {
            return res.status(401).json({
                error: 'Usuário não autenticado'
            });
        }

        // Verificar se a conversa pertence ao usuário
        const conversation = await database.get(
            'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
            [conversationId, req.user.id]
        );

        if (!conversation) {
            return res.status(404).json({
                error: 'Conversa não encontrada'
            });
        }

        const messages = await database.all(
            'SELECT id, role, content, created_at, tokens_used, model_used FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
            [conversationId]
        );

        res.json({
            conversation,
            messages
        });

    } catch (error) {
        console.error('Erro ao buscar mensagens:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Deletar conversa
router.delete('/conversations/:conversationId', optionalAuth, async (req, res) => {
    try {
        const { conversationId } = req.params;
        
        if (!req.user) {
            return res.status(401).json({
                error: 'Usuário não autenticado'
            });
        }

        // Verificar se a conversa pertence ao usuário
        const conversation = await database.get(
            'SELECT id FROM conversations WHERE id = ? AND user_id = ?',
            [conversationId, req.user.id]
        );

        if (!conversation) {
            return res.status(404).json({
                error: 'Conversa não encontrada'
            });
        }

        // Deletar mensagens primeiro (foreign key constraint)
        await database.run('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
        
        // Deletar conversa
        await database.run('DELETE FROM conversations WHERE id = ?', [conversationId]);

        res.json({
            message: 'Conversa deletada com sucesso'
        });

    } catch (error) {
        console.error('Erro ao deletar conversa:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Buscar sugestões rápidas baseadas no modo
router.get('/suggestions/:mode', async (req, res) => {
    try {
        const { mode } = req.params;

        const suggestions = {
            consulta: [
                'Como está o IBOVESPA hoje?',
                'Analise o cenário do dólar americano',
                'Quais ações estão em alta esta semana?',
                'Explique o conceito de análise fundamentalista',
                'Como diversificar minha carteira de investimentos?'
            ],
            daytrade: [
                'Analise o WINFUT para day trade hoje',
                'Pontos de entrada e saída no INDFUT',
                'Setup para operar DOLFUT agora',
                'Estratégia de scalping no mini índice',
                'Como identificar breakouts no WDOFUT?'
            ],
            portfolio: [
                'Analise meu portfólio de ações brasileiras',
                'Como rebalancear minha carteira?',
                'Diversificação entre renda fixa e variável',
                'Estratégias para mercado em baixa',
                'Alocação ideal por idade e perfil'
            ],
            robot: [
                'Crie um robô de scalping em NTFL',
                'Estratégia automatizada de breakout',
                'Robô para swing trade com stop móvel',
                'Sistema de grid trading programado',
                'Indicadores customizados para Nelogica'
            ]
        };

        res.json({
            suggestions: suggestions[mode] || suggestions.consulta
        });

    } catch (error) {
        console.error('Erro ao buscar sugestões:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Estatísticas do usuário
router.get('/stats', optionalAuth, async (req, res) => {
    try {
        if (!req.user) {
            return res.json({
                stats: {
                    totalMessages: 0,
                    totalConversations: 0,
                    creditsUsed: 0,
                    favoriteMode: 'consulta'
                }
            });
        }

        const stats = await database.get(
            `SELECT 
                COUNT(DISTINCT c.id) as totalConversations,
                COUNT(m.id) as totalMessages,
                (5 - u.credits) as creditsUsed
             FROM users u
             LEFT JOIN conversations c ON c.user_id = u.id
             LEFT JOIN messages m ON m.conversation_id = c.id AND m.role = 'user'
             WHERE u.id = ?`,
            [req.user.id]
        );

        // Buscar modo favorito
        const favoriteMode = await database.get(
            `SELECT mode, COUNT(*) as count 
             FROM conversations 
             WHERE user_id = ? 
             GROUP BY mode 
             ORDER BY count DESC 
             LIMIT 1`,
            [req.user.id]
        );

        res.json({
            stats: {
                totalMessages: stats.totalMessages || 0,
                totalConversations: stats.totalConversations || 0,
                creditsUsed: stats.creditsUsed || 0,
                favoriteMode: favoriteMode?.mode || 'consulta'
            }
        });

    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

module.exports = router;