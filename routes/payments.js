const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { body, validationResult } = require('express-validator');
const database = require('../database/init');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Planos disponíveis
const PLANS = {
    basic: {
        name: 'Plano Básico',
        price: 29.90,
        credits: 100,
        features: ['100 créditos mensais', 'Todos os modos de análise', 'Suporte por email']
    },
    premium: {
        name: 'Plano Premium',
        price: 59.90,
        credits: -1, // Ilimitado
        features: ['Créditos ilimitados', 'Prioridade nas respostas', 'Suporte 24/7', 'Análises personalizadas']
    },
    unlimited: {
        name: 'Plano Unlimited',
        price: 99.90,
        credits: -1, // Ilimitado
        features: ['Tudo do Premium', 'Acesso a modelos avançados', 'Consultoria personalizada', 'API privada']
    }
};

const CREDIT_PACKAGES = {
    small: {
        name: '50 Créditos',
        credits: 50,
        price: 9.90
    },
    medium: {
        name: '150 Créditos',
        credits: 150,
        price: 24.90
    },
    large: {
        name: '300 Créditos',
        credits: 300,
        price: 39.90
    }
};

// Listar planos disponíveis
router.get('/plans', async (req, res) => {
    try {
        res.json({
            plans: PLANS
        });
    } catch (error) {
        console.error('Erro ao buscar planos:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Listar pacotes de crédito
router.get('/credits', async (req, res) => {
    try {
        res.json({
            packages: CREDIT_PACKAGES
        });
    } catch (error) {
        console.error('Erro ao buscar pacotes:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Criar sessão de checkout para upgrade de plano
router.post('/create-checkout-session', [
    authenticateToken,
    body('type').isIn(['plan', 'credits']),
    body('planId').optional().isIn(Object.keys(PLANS)),
    body('packageId').optional().isIn(Object.keys(CREDIT_PACKAGES))
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Dados inválidos',
                details: errors.array()
            });
        }

        const { type, planId, packageId } = req.body;
        let sessionData;

        if (type === 'plan' && planId) {
            const plan = PLANS[planId];
            if (!plan) {
                return res.status(400).json({ error: 'Plano inválido' });
            }

            sessionData = {
                payment_method_types: ['card'],
                line_items: [{
                    price_data: {
                        currency: 'brl',
                        product_data: {
                            name: plan.name,
                            description: plan.features.join(', ')
                        },
                        unit_amount: Math.round(plan.price * 100), // Stripe usa centavos
                        recurring: {
                            interval: 'month'
                        }
                    },
                    quantity: 1,
                }],
                mode: 'subscription',
                success_url: `${process.env.FRONTEND_URL}/chat-ia?upgrade=success&plan=${planId}`,
                cancel_url: `${process.env.FRONTEND_URL}/chat-ia?upgrade=cancelled`,
                customer_email: req.user.email,
                metadata: {
                    userId: req.user.id,
                    type: 'plan_upgrade',
                    planId: planId
                }
            };
        } else if (type === 'credits' && packageId) {
            const package = CREDIT_PACKAGES[packageId];
            if (!package) {
                return res.status(400).json({ error: 'Pacote inválido' });
            }

            sessionData = {
                payment_method_types: ['card'],
                line_items: [{
                    price_data: {
                        currency: 'brl',
                        product_data: {
                            name: package.name,
                            description: `${package.credits} créditos para usar no SharkMind AI`
                        },
                        unit_amount: Math.round(package.price * 100)
                    },
                    quantity: 1,
                }],
                mode: 'payment',
                success_url: `${process.env.FRONTEND_URL}/chat-ia?purchase=success&credits=${package.credits}`,
                cancel_url: `${process.env.FRONTEND_URL}/chat-ia?purchase=cancelled`,
                customer_email: req.user.email,
                metadata: {
                    userId: req.user.id,
                    type: 'credit_purchase',
                    packageId: packageId,
                    credits: package.credits
                }
            };
        } else {
            return res.status(400).json({ error: 'Tipo de compra inválido' });
        }

        const session = await stripe.checkout.sessions.create(sessionData);

        // Registrar transação pendente
        await database.run(
            'INSERT INTO transactions (user_id, type, amount, credits, status, stripe_payment_id) VALUES (?, ?, ?, ?, ?, ?)',
            [
                req.user.id,
                type === 'plan' ? 'plan_upgrade' : 'credit_purchase',
                type === 'plan' ? PLANS[planId].price : CREDIT_PACKAGES[packageId].price,
                type === 'plan' ? 0 : CREDIT_PACKAGES[packageId].credits,
                'pending',
                session.id
            ]
        );

        res.json({
            sessionId: session.id,
            url: session.url
        });

    } catch (error) {
        console.error('Erro ao criar sessão de checkout:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Webhook do Stripe para processar pagamentos
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Erro na verificação do webhook:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutCompleted(event.data.object);
                break;

            case 'invoice.payment_succeeded':
                await handleSubscriptionPayment(event.data.object);
                break;

            case 'customer.subscription.deleted':
                await handleSubscriptionCancelled(event.data.object);
                break;

            default:
                console.log(`Evento não tratado: ${event.type}`);
        }

        res.json({ received: true });

    } catch (error) {
        console.error('Erro ao processar webhook:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Processar checkout completado
async function handleCheckoutCompleted(session) {
    const { userId, type, planId, packageId, credits } = session.metadata;

    // Atualizar status da transação
    await database.run(
        'UPDATE transactions SET status = ? WHERE stripe_payment_id = ?',
        ['completed', session.id]
    );

    if (type === 'plan_upgrade') {
        // Upgrade de plano
        await database.run(
            'UPDATE users SET plan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [planId, userId]
        );

        // Se for plano premium/unlimited, dar créditos ilimitados
        if (planId === 'premium' || planId === 'unlimited') {
            await database.run(
                'UPDATE users SET credits = 9999 WHERE id = ?',
                [userId]
            );
        } else if (planId === 'basic') {
            await database.run(
                'UPDATE users SET credits = credits + 100 WHERE id = ?',
                [userId]
            );
        }

        console.log(`Usuário ${userId} fez upgrade para o plano ${planId}`);

    } else if (type === 'credit_purchase') {
        // Compra de créditos
        await database.run(
            'UPDATE users SET credits = credits + ? WHERE id = ?',
            [parseInt(credits), userId]
        );

        console.log(`Usuário ${userId} comprou ${credits} créditos`);
    }
}

// Processar pagamento de assinatura
async function handleSubscriptionPayment(invoice) {
    // Implementar lógica para pagamentos recorrentes
    console.log('Pagamento de assinatura processado:', invoice.id);
}

// Processar cancelamento de assinatura
async function handleSubscriptionCancelled(subscription) {
    // Encontrar usuário pela subscription
    const customer = await stripe.customers.retrieve(subscription.customer);
    
    if (customer.email) {
        const user = await database.get('SELECT id FROM users WHERE email = ?', [customer.email]);
        
        if (user) {
            // Downgrade para plano free
            await database.run(
                'UPDATE users SET plan = ?, credits = 5 WHERE id = ?',
                ['free', user.id]
            );
            
            console.log(`Assinatura cancelada para usuário ${user.id}`);
        }
    }
}

// Buscar status de pagamento
router.get('/status/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;

        const transaction = await database.get(
            'SELECT * FROM transactions WHERE stripe_payment_id = ? AND user_id = ?',
            [sessionId, req.user.id]
        );

        if (!transaction) {
            return res.status(404).json({
                error: 'Transação não encontrada'
            });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        res.json({
            status: transaction.status,
            payment_status: session.payment_status,
            amount: transaction.amount,
            credits: transaction.credits
        });

    } catch (error) {
        console.error('Erro ao buscar status:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

// Cancelar assinatura
router.post('/cancel-subscription', authenticateToken, async (req, res) => {
    try {
        const user = await database.get('SELECT email FROM users WHERE id = ?', [req.user.id]);
        
        // Buscar customer no Stripe
        const customers = await stripe.customers.list({
            email: user.email,
            limit: 1
        });

        if (customers.data.length === 0) {
            return res.status(404).json({
                error: 'Assinatura não encontrada'
            });
        }

        const customer = customers.data[0];
        
        // Buscar assinaturas ativas
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'active'
        });

        if (subscriptions.data.length === 0) {
            return res.status(404).json({
                error: 'Nenhuma assinatura ativa encontrada'
            });
        }

        // Cancelar primeira assinatura ativa
        const subscription = subscriptions.data[0];
        await stripe.subscriptions.del(subscription.id);

        res.json({
            message: 'Assinatura cancelada com sucesso'
        });

    } catch (error) {
        console.error('Erro ao cancelar assinatura:', error);
        res.status(500).json({
            error: 'Erro interno do servidor'
        });
    }
});

module.exports = router;