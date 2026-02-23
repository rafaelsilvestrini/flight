const express = require('express');
const cors = require('cors');
const { scrapeFlights } = require('./scraping-final');
const app = express();

app.use(cors());
app.use(express.json());

// ROTA 1: POST /search-flights
app.post('/search-flights', async (req, res) => {
    const { origin, destination, departureDate, additional_days_num, debug } = req.body;
    try {
        const result = await scrapeFlights({ origin, destination, departureDate, days: additional_days_num, debug });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ROTA 2: /arriving/:airport e /departing/:airport
app.get('/:type/:airport', async (req, res) => {
    const { type, airport } = req.params;
    const { debug } = req.query;

    if (!['arriving', 'departing'].includes(type)) {
        return res.status(404).json({ error: 'Use /arriving ou /departing' });
    }

    try {
        const url = `https://seats.aero/smiles/${type}/${airport.toUpperCase()}`;
        const result = await scrapeFlights({ urlDirect: url, debug: debug === 'true' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ROTA 3: /smiles, /azul, etc.
app.get('/:name', async (req, res) => {
    const { name } = req.params;
    const { debug } = req.query;
    if (name === 'arriving' || name === 'departing' || name === 'search-flights') return;

    try {
        const result = await scrapeFlights({ 
            urlDirect: `https://seats.aero/${name.toLowerCase()}`, 
            debug: debug === 'true'
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => console.log('API Rodando na porta 3000'));