const express = require('express');
const cors = require('cors');
const { scrapeFlights } = require('./scraping-final');

const app = express();
app.use(cors());
app.use(express.json());

// Objeto de Cache em Memória
const searchCache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos em milissegundos

app.post('/search-flights', async (req, res) => {
    const { origin, destination, departureDate, additional_days_num, debug = false } = req.body;
    
    const allowedDays = [1, 3, 7, 14, 28, 60, 160];
    const days = parseInt(additional_days_num);

    if (!origin || !destination || !departureDate || !allowedDays.includes(days)) {
        return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }

    // Criar uma chave única para a pesquisa
    const cacheKey = `${origin}-${destination}-${departureDate}-${days}`.toUpperCase();

    // 1. Verificar Cache
    if (searchCache.has(cacheKey)) {
        const cachedData = searchCache.get(cacheKey);
        const now = Date.now();

        if (now - cachedData.timestamp < CACHE_DURATION) {
            if (debug) console.log(`[CACHE] Retornando dados do cache para: ${cacheKey}`);
            return res.json({ results: cachedData.data, cached: true });
        } else {
            if (debug) console.log(`[CACHE] Cache expirado para: ${cacheKey}. Removendo...`);
            searchCache.delete(cacheKey);
        }
    }

    const [d, m, y] = departureDate.split('/');
    const formattedDate = `${y}-${m}-${d}`;

    try {
        if (debug) console.log(`[SERVER] Iniciando nova pesquisa para: ${cacheKey}`);
        
        const result = await scrapeFlights({ 
            origin, 
            destination, 
            departureDate: formattedDate,
            days,
            debug
        });

        // 2. Salvar no Cache se houver resultados
        if (result.result && Array.isArray(result.result)) {
            searchCache.set(cacheKey, {
                timestamp: Date.now(),
                data: result.result
            });
            if (debug) console.log(`[CACHE] Nova pesquisa salva por 30 min: ${cacheKey}`);
        }

        res.json({ results: result.result, cached: false });

    } catch (error) {
        res.status(500).json({ error: 'Erro no processo.', details: error.message });
    } finally {
        if (global.gc) global.gc();
        
        // Limpeza periódica do Map para não acumular lixo (OPCIONAL)
        if (searchCache.size > 100) { // Se o cache tiver mais de 100 pesquisas, limpa as velhas
            const agora = Date.now();
            for (let [key, val] of searchCache) {
                if (agora - val.timestamp > CACHE_DURATION) searchCache.delete(key);
            }
        }
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor com Cache Ativo - Porta ${PORT}`);
});