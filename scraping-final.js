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

        // Flags para evitar detecção e otimizar RAM na VPS
        const browserArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--disable-blink-features=AutomationControlled',
            isLinux ? '--display=:99' : '--start-maximized'
        ];

        const response = await connect({
            headless: isHeadless,
            args: browserArgs,
            customConfig: { executablePath: chromePath },
            turnstile: true,
            disableXvfb: true
        });

        browser = response.browser;
        page = response.page;

        const searchUrl = `https://seats.aero/search?min_seats=1&applicable_cabin=any&additional_days=true&additional_days_num=${days}&max_fees=40000&date=${departureDate}&origins=${origin}&destinations=${destination}`;

        log(`Navegando para: ${searchUrl}`);
        // Aumentado timeout para 60s (VPS pode oscilar rede)
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        log('Aguardando bypass do Cloudflare (15s)...');
        await delay(15000); 

        // Captura screenshot se estiver em modo debug para diagnosticar erros de carregamento
        if (debug) await page.screenshot({ path: 'last_view.png' });

        const isWarning = await page.$('.alert-warning');
        if (isWarning) {
            const msg = await page.evaluate(el => el.textContent.trim(), isWarning);
            log(`Aviso encontrado: ${msg}`);
            await browser.close();
            return { result: msg };
        }

        log('Aguardando tabela de preços (Timeout 60s)...');
        // Aumentado timeout para evitar o erro de 30s
        await page.waitForSelector('table tbody tr td .badge', { timeout: 60000 });

        log('Ordenando por Econômica...');
        const sortBtn = 'span[aria-label^="Econômica"]';
        await page.waitForSelector(sortBtn);
        await page.click(sortBtn);
        await delay(3000);

        log('Extraindo dados...');
        const flightsData = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('table tbody tr'))
                          .filter(r => r.querySelector('.open-modal-btn'));
            
            return rows.map(row => {
                const cols = row.querySelectorAll('td');
                const getCabin = (td) => {
                    const b = td.querySelector('.badge');
                    if (!b || b.innerText.includes('Indisponível')) return 'Indisponível';
                    return {
                        pontos: b.innerText.trim(),
                        detalhes: b.getAttribute('data-bs-original-title') || b.getAttribute('title') || ''
                    };
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

        if (flightsData.length > 0) {
            const buttons = await page.$$('button.open-modal-btn');
            if (buttons[0]) {
                await buttons[0].click();
                await delay(3000);
                flightsData[0].links_reserva = await page.$$eval('#bookingOptions a.dropdown-item', els =>
                    els.map(el => ({ parceiro: el.textContent.trim(), url: el.href }))
                );
            }
        }

        log('Sucesso! Fechando navegador.');
        await browser.close();
        return { result: flightsData };

    } catch (error) {
        log(`FALHA NO SCRAPER: ${error.message}`);
        if (browser) await browser.close();
        throw error;
    }
};

module.exports = { scrapeFlights };