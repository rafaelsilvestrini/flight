const { connect } = require('puppeteer-real-browser');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scrapeFlights = async ({ origin, destination, departureDate, days, debug }) => {
    const isHeadless = debug === true ? false : true;

    const log = (msg) => {
        if (debug) console.log(`[DEBUG LOG ${new Date().toLocaleTimeString()}] -> ${msg}`);
    };

    try {
        log('Iniciando conexão inteligente com o navegador...');

        // DETECÇÃO AUTOMÁTICA DE AMBIENTE
        const isLinux = process.platform === 'linux';
        const chromePath = isLinux ? '/usr/bin/google-chrome-stable' : undefined;

        // Flags base que funcionam em ambos
        const browserArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote'
        ];

        // Se estiver no Linux (Easypanel), adiciona a flag do Xvfb
        if (isLinux) {
            browserArgs.push('--display=:99');
        } else {
            browserArgs.push('--start-maximized');
        }

        const { browser, page } = await connect({
            headless: isHeadless,
            args: browserArgs,
            customConfig: {
                executablePath: chromePath
            },
            turnstile: true,
        });

        const searchUrl = `https://seats.aero/search?min_seats=1&applicable_cabin=any&additional_days=true&additional_days_num=${days}&max_fees=40000&date=${departureDate}&origins=${origin}&destinations=${destination}`;

        log(`Navegando para: ${searchUrl}`);
        await page.goto(searchUrl, { waitUntil: 'networkidle2' });
        
        log('Aguardando processamento inicial...');
        await delay(10000); 

        const isWarning = await page.$('.alert-warning');
        if (isWarning) {
            const msg = await page.evaluate(el => el.textContent.trim(), isWarning);
            log(`Aviso: ${msg}`);
            await browser.close();
            return { result: msg };
        }

        log('Aguardando tabela de voos...');
        await page.waitForSelector('table tbody tr td .badge', { timeout: 30000 });

        log('Ordenando por Econômica...');
        const sortBtn = 'span[aria-label^="Econômica"]';
        await page.waitForSelector(sortBtn);
        await page.click(sortBtn);
        await delay(3000);

        log('Extraindo resultados...');
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

        log('Finalizado com sucesso.');
        await browser.close();
        return { result: flightsData };

    } catch (error) {
        log(`FALHA NO SCRAPER: ${error.message}`);
        throw error;
    }
};

module.exports = { scrapeFlights };