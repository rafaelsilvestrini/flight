const { connect } = require('puppeteer-real-browser');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scrapeFlights = async ({ origin, destination, departureDate, days, debug, urlDirect }) => {
    const isLinux = process.platform === 'linux';
    const isHeadless = isLinux ? true : (debug === true ? false : true);
    const log = (msg) => { if (debug) console.log(`[DEBUG LOG ${new Date().toLocaleTimeString()}] -> ${msg}`); };

    let browser, page;

    try {
        const { browser: connectedBrowser, page: connectedPage } = await connect({
            headless: isHeadless,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-blink-features=AutomationControlled'
            ],
            turnstile: true,
            disableXvfb: true
        });

        browser = connectedBrowser;
        page = connectedPage;

        // User Agent mais recente para evitar detecção
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const isSearchRoute = !urlDirect;
        const searchUrl = urlDirect || `https://seats.aero/search?min_seats=1&applicable_cabin=any&additional_days=true&additional_days_num=${days}&max_fees=40000&date=${departureDate}&origins=${origin}&destinations=${destination}`;

        log(`Navegando para: ${searchUrl}`);
        
        // Aumentei o timeout para garantir que carregue em redes lentas
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 90000 });
        
        log('Aguardando renderização da tabela (25s)...');
        await delay(25000); 

        // Tenta encontrar a tabela ou as linhas antes de prosseguir
        try {
            await page.waitForSelector('table tbody tr', { timeout: 15000 });
        } catch (e) {
            log('Aviso: Tabela não apareceu no tempo esperado. Tentando extrair assim mesmo.');
        }

        const flightsData = await page.evaluate((isSearchRoute) => {
            const getCabin = (td) => {
                const b = td?.querySelector('.badge');
                if (!b || b.innerText.includes('Indisponível')) return 'Indisponível';
                return {
                    pontos: b.innerText.trim(),
                    detalhes: b.getAttribute('data-bs-original-title') || b.getAttribute('title') || ''
                };
            };

            const rows = Array.from(document.querySelectorAll('table tbody tr'));
            // Filtra linhas que realmente contém dados (botão de reserva)
            const dataRows = rows.filter(r => r.querySelector('.open-modal-btn') || r.querySelectorAll('td').length > 5);
            
            // Search: 0:Data, 2:Prog, 3:Orig, 4:Dest, 5:Econ, 6:Prem, 7:Bus, 8:First
            // Direct: 0:Data, 1:Voo, 2:Orig, 3:Dest, 4:Econ, 5:Prem, 6:Bus, 7:First
            const idx = isSearchRoute 
                ? { data: 0, prog: 2, orig: 3, dest: 4, econ: 5, prem: 6, exec: 7, first: 8 }
                : { data: 0, prog: -1, orig: 2, dest: 3, econ: 4, prem: 5, exec: 6, first: 7 };

            return dataRows.map(row => {
                const cols = row.querySelectorAll('td');
                if (cols.length < 5) return null;

                const res = {
                    data: cols[idx.data]?.innerText.trim(),
                    origem: cols[idx.orig]?.innerText.trim(),
                    destino: cols[idx.dest]?.innerText.trim(),
                    economica: getCabin(cols[idx.econ]),
                    premium: getCabin(cols[idx.prem]),
                    executiva: getCabin(cols[idx.exec]),
                    primeira: getCabin(cols[idx.first])
                };

                if (isSearchRoute) {
                    res.programa = cols[idx.prog]?.innerText.trim();
                }
                return res;
            }).filter(item => item !== null);
        }, isSearchRoute);

        // Extração de Links de Reserva
        if (flightsData.length > 0) {
            log(`Encontrados ${flightsData.length} vôos. Pegando links do primeiro...`);
            const buttons = await page.$$('button.open-modal-btn');
            if (buttons.length > 0) {
                await buttons[0].click();
                await delay(3000);
                flightsData[0].links_reserva = await page.$$eval('#bookingOptions a.dropdown-item', els =>
                    els.map(el => ({ parceiro: el.textContent.trim(), url: el.href }))
                );
            }
        }

        await browser.close();
        return { result: flightsData };
    } catch (error) {
        log(`ERRO CRÍTICO: ${error.message}`);
        if (browser) await browser.close();
        throw error;
    }
};

module.exports = { scrapeFlights };