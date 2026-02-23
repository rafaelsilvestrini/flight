const { connect } = require('puppeteer-real-browser');
const fs = require('fs');

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

        const { browser: connectedBrowser, page: connectedPage } = await connect({
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

        browser = connectedBrowser;
        page = connectedPage;

        // Configurações extras para evitar bloqueio na VPS
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const searchUrl = `https://seats.aero/search?min_seats=1&applicable_cabin=any&additional_days=true&additional_days_num=${days}&max_fees=40000&date=${departureDate}&origins=${origin}&destinations=${destination}`;

        log(`Navegando para: ${searchUrl}`);
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        log('Aguardando bypass e carregamento (20s)...');
        await delay(20000); 

        // Tira print para diagnóstico (essencial na VPS)
        if (debug) {
            await page.screenshot({ path: 'vps_debug.png', fullPage: true });
            log('Screenshot salva como vps_debug.png');
        }

        const isWarning = await page.$('.alert-warning');
        if (isWarning) {
            const msg = await page.evaluate(el => el.textContent.trim(), isWarning);
            log(`Aviso: ${msg}`);
            await browser.close();
            return { result: msg };
        }

        log('Aguardando tabela de resultados...');
        // Tentamos esperar por qualquer célula da tabela antes da badge específica
        await page.waitForSelector('table tbody tr', { timeout: 60000 });

        log('Ordenando por Econômica...');
        const sortBtn = 'span[aria-label^="Econômica"]';
        await page.waitForSelector(sortBtn, { timeout: 10000 }).catch(() => log('Botão de ordenação não encontrado, continuando...'));
        await page.click(sortBtn).catch(() => {});
        await delay(3000);

        log('Extraindo dados...');
        const flightsData = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('table tbody tr'))
                          .filter(r => r.querySelector('.open-modal-btn'));
            
            return rows.map(row => {
                const cols = row.querySelectorAll('td');
                const getCabin = (td) => {
                    const b = td?.querySelector('.badge');
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
            log('Buscando links de reserva...');
            const buttons = await page.$$('button.open-modal-btn');
            if (buttons[0]) {
                await buttons[0].click();
                await delay(3000);
                flightsData[0].links_reserva = await page.$$eval('#bookingOptions a.dropdown-item', els =>
                    els.map(el => ({ parceiro: el.textContent.trim(), url: el.href }))
                );
            }
        }

        log('Finalizado.');
        await browser.close();
        return { result: flightsData };

    } catch (error) {
        log(`ERRO: ${error.message}`);
        if (browser) {
            // Se falhou, tenta um print do erro antes de fechar
            try { await page.screenshot({ path: 'error_fatal.png' }); } catch(e) {}
            await browser.close();
        }
        throw error;
    }
};

module.exports = { scrapeFlights };