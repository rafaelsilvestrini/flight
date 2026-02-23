const express = require('express');
const cors = require('cors');
const { scrapeFlights } = require('./scraping-final');

const app = express();
app.use(cors());
app.use(express.json());

const searchCache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; 

app.post('/search-flights', async (req, res) => {
    const { origin, destination, departureDate, additional_days_num, debug = false } = req.body;
    
    if (debug) console.log('\n--- INÍCIO DA REQUISIÇÃO ---');

    const allowedDays = [1, 3, 7, 14, 28, 60, 160];
    const days = parseInt(additional_days_num);

    if (!origin || !destination || !departureDate || !allowedDays.includes(days)) {
        return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }

    const cacheKey = `${origin}-${destination}-${departureDate}-${days}`.toUpperCase();

    if (!debug && searchCache.has(cacheKey)) {
        const cachedItem = searchCache.get(cacheKey);
        if (Date.now() - cachedItem.timestamp < CACHE_DURATION) {
            return res.json({ results: cachedItem.data, cached: true });
        }
        searchCache.delete(cacheKey);
    }

    try {
        const result = await scrapeFlights({ 
            origin, 
            destination, 
            departureDate, 
            days, 
            debug 
        });

        if (Array.isArray(result.result)) {
            searchCache.set(cacheKey, { 
                timestamp: Date.now(), 
                data: result.result 
            });
        }

        res.json({ results: result.result, cached: false });

    } catch (error) {
        res.status(500).json({ error: 'Erro no processo.', details: error.message });
    } finally {
        if (global.gc) global.gc();
        if (debug) console.log('--- FIM DA OPERAÇÃO ---\n');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API Rodando na porta ${PORT}`));