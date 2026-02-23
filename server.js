const express = require('express');
const cors = require('cors');
const { scrapeFlights } = require('./scraping-final');

const app = express();
app.use(cors());
app.use(express.json());

// Estrutura de Cache
const searchCache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos

app.post('/search-flights', async (req, res) => {
    const { origin, destination, departureDate, additional_days_num, debug = false } = req.body;
    
    if (debug) console.log('\n--- INÍCIO DA REQUISIÇÃO ---');

    const allowedDays = [1, 3, 7, 14, 28, 60, 160];
    const days = parseInt(additional_days_num);

    if (!origin || !destination || !departureDate || !allowedDays.includes(days)) {
        return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }

    // Chave única para identificar se a pesquisa já foi feita
    const cacheKey = `${origin}-${destination}-${departureDate}-${days}`.toUpperCase();

    // Lógica de Cache
    if (searchCache.has(cacheKey)) {
        const cachedItem = searchCache.get(cacheKey);
        if (Date.now() - cachedItem.timestamp < CACHE_DURATION) {
            if (debug) console.log(`[CACHE HIT] Retornando dados para: ${cacheKey}`);
            return res.json({ results: cachedItem.data, cached: true });
        }
        searchCache.delete(cacheKey); // Remove se expirou
    }

    // Formata a data para o padrão Seats.aero
    const [d, m, y] = departureDate.split('/');
    const formattedDate = `${y}-${m}-${d}`;

    try {
        if (debug) console.log(`[SERVER] Pesquisando dados novos para: ${cacheKey}`);
        
        const result = await scrapeFlights({ 
            origin, 
            destination, 
            departureDate: formattedDate, 
            days, 
            debug 
        });

        // Salva no cache se for um array válido
        if (Array.isArray(result.result)) {
            searchCache.set(cacheKey, { 
                timestamp: Date.now(), 
                data: result.result 
            });
        }

        res.json({ results: result.result, cached: false });

    } catch (error) {
        if (debug) console.error(`[ERRO SERVER]: ${error.message}`);
        res.status(500).json({ error: 'Erro no processo.', details: error.message });
    } finally {
        // Limpeza de memória obrigatória para manter o consumo baixo
        if (global.gc) {
            if (debug) console.log('[MEMÓRIA] Executando Garbage Collector...');
            global.gc();
        }
        if (debug) console.log('--- FIM DA OPERAÇÃO ---\n');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`API Milhas ONLINE - Porta ${PORT}`);
});