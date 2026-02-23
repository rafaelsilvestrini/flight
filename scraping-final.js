const { connect } = require('puppeteer-real-browser');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scrapeFlights = async ({ origin, destination, departureDate, days, debug }) => {
    const isLinux = process.platform === 'linux';
    const isHeadless = isLinux ? true : (debug === true ? false : true);

    const log = (msg) => {
        if (debug) console.log(`[DEBUG LOG ${new Date().toLocaleTimeString()}] -> ${msg}`);
    };

    let browser, page;

    try {
        log(`Iniciando conexão (Ambiente: ${process.platform})...`);

        const chromePath = isLinux ? '/usr/bin/google-chrome-stable' : undefined;

        // AQUI ESTÁ A CHAVE: disableXvfb deve ser FALSE para o plugin gerenciar o display
        const { browser: connectedBrowser, page: connectedPage } = await connect({
            headless: isHeadless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--disable-blink-features=AutomationControlled'
            ],
            customConfig: { executablePath: chromePath },
            turnstile: true,
            disableXvfb: false 
        });

        browser = connectedBrowser;
        page = connectedPage;

        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const searchUrl = `https://seats.aero/search?min_seats=1&applicable_cabin=any&additional_days=true&additional_days_num=${days}&max_fees=40000&date=${departureDate}&origins=${origin}&destinations=${destination}`;

        log(`Navegando para: ${searchUrl}`);
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        log('Aguardando carregamento (20s)...');
        await delay(20000); 

        if (debug) await page.screenshot({ path: 'vps_debug.png' });

        // --- ORDENAÇÃO ROBUSTA (NÃO TRAVA SE FALHAR) ---
        try {
            log('Tentando ordenar por Econômica...');
            const clicked = await page.evaluate(() => {
                const titles = Array.from(document.querySelectorAll('.dt-column-title'));
                const econSpan = titles.find(el => el.innerText.trim() === 'Econômica');
                if (econSpan) {
                    const parentTh = econSpan.closest('th');
                    if (parentTh) { parentTh.click(); return true; }
                }
                return false;
            });
            if (clicked) await delay(5000);
        } catch (e) {
            log('Aviso: Falha na ordenação, prosseguindo...');
        }

        log('Extraindo dados...');
        const flightsData = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('table tbody tr'))
                          .filter(r => r.querySelector('.open-modal-btn'));
            
            return rows.map(row => {
                const cols = row.querySelectorAll('td');
                const getCabin = (td) => {
                    const b = td?.querySelector('.badge');
                    if (!b || b.innerText.includes('Indisponível')) return 'Indisponível';
                    return { pontos: b.innerText.trim() };
                };
                return {
                    data: cols[0]?.innerText.trim(),
                    programa: cols[2]?.innerText.trim(),
                    origem: cols[3]?.innerText.trim(),
                    destino: cols[4]?.innerText.trim(),
                    economica: getCabin(cols[5]),
                    executiva: getCabin(cols[6])
                };
            });
        });

        await browser.close();
        return { result: flightsData };

    } catch (error) {
        log(`ERRO: ${error.message}`);
        if (browser) await browser.close();
        throw error;
    }
};

module.exports = { scrapeFlights };