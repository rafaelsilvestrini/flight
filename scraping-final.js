const { connect } = require('puppeteer-real-browser');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scrapeFlights = async ({ origin, destination, departureDate, days, debug }) => {
    // No Docker, headless precisa ser true se debug for false
    const isHeadless = debug === true ? false : true;

    const log = (msg) => {
        if (debug) console.log(`[DEBUG LOG ${new Date().toLocaleTimeString()}] -> ${msg}`);
    };

    try {
        log('Iniciando conexão com o navegador...');

        // Detecta se é Linux (Docker) para setar o caminho do Chrome
        const chromePath = process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : undefined;

        const { browser, page } = await connect({
            headless: isHeadless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote'
            ],
            customConfig: {
                executablePath: chromePath
            },
            turnstile: true,
        });

        const searchUrl = `https://seats.aero/search?min_seats=1&applicable_cabin=any&additional_days=true&additional_days_num=${days}&max_fees=40000&date=${departureDate}&origins=${origin}&destinations=${destination}`;

        log(`Navegando para: ${searchUrl}`);
        await page.goto(searchUrl, { waitUntil: 'networkidle2' });
        
        log('Bypass Cloudflare: aguardando renderização...');
        await delay(10000); 

        const isWarning = await page.$('.alert-warning');
        if (isWarning) {
            const msg = await page.evaluate(el => el.textContent.trim(), isWarning);
            log(`Aviso do site: ${msg}`);
            await browser.close();
            return { result: msg };
        }

        log('Aguardando tabela de resultados...');
        await page.waitForSelector('table tbody tr td .badge', { timeout: 30000 });

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
            log('Extraindo links de reserva do voo mais barato...');
            const buttons = await page.$$('button.open-modal-btn');
            if (buttons[0]) {
                await buttons[0].click();
                await delay(3000);
                flightsData[0].links_reserva = await page.$$eval('#bookingOptions a.dropdown-item', els =>
                    els.map(el => ({ parceiro: el.textContent.trim(), url: el.href }))
                );
            }
        }

        log('Fechando navegador.');
        await browser.close();
        return { result: flightsData };

    } catch (error) {
        log(`ERRO NO PROCESSO: ${error.message}`);
        throw error;
    }
};

module.exports = { scrapeFlights };