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

        const response = await connect({
            headless: isHeadless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--disable-blink-features=AutomationControlled',
                isLinux ? '--display=:99' : '--start-maximized'
            ],
            customConfig: { executablePath: chromePath },
            turnstile: true,
            disableXvfb: true
        });

        browser = response.browser;
        page = response.page;

        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const searchUrl = `https://seats.aero/search?min_seats=1&applicable_cabin=any&additional_days=true&additional_days_num=${days}&max_fees=40000&date=${departureDate}&origins=${origin}&destinations=${destination}`;

        log(`Navegando para: ${searchUrl}`);
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        log('Aguardando carregamento (20s)...');
        await delay(20000); 

        if (debug) await page.screenshot({ path: 'vps_debug.png', fullPage: true });

        // Ordenação Opcional
        try {
            log('Tentando ordenar...');
            await page.waitForSelector('th[data-dt-column="5"]', { timeout: 10000 });
            await page.evaluate(() => {
                const el = document.querySelector('th[data-dt-column="5"]');
                if (el) el.click();
            });
            await delay(5000);
        } catch (e) {
            log('Aviso: Pulando ordenação.');
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