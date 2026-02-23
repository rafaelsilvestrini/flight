const { connect } = require('puppeteer-real-browser');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scrapeFlights = async ({ origin, destination, departureDate, days, debug }) => {
    const isHeadless = debug === true ? false : true;

    // Função auxiliar para logs
    const log = (msg) => {
        if (debug) console.log(`[DEBUG LOG ${new Date().toLocaleTimeString()}] -> ${msg}`);
    };

    try {
        log('Iniciando conexão com o navegador...');
        const { browser, page } = await connect({
            headless: isHeadless,
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ],
            turnstile: true,
        });

        const searchUrl = `https://seats.aero/search?min_seats=1&applicable_cabin=any&additional_days=true&additional_days_num=${days}&max_fees=40000&date=${departureDate}&origins=${origin}&destinations=${destination}`;

        log(`Navegando para URL: ${searchUrl}`);
        await page.goto(searchUrl, { waitUntil: 'networkidle2' });
        
        log('Aguardando 10s para bypass do Cloudflare e renderização...');
        await delay(10000); 

        log('Verificando se existem avisos de "Voo não encontrado"...');
        const isWarning = await page.$('.alert-warning');
        if (isWarning) {
            const msg = await page.evaluate(el => el.textContent.trim(), isWarning);
            log(`Aviso do site: ${msg}`);
            await browser.close();
            return { result: msg };
        }

        log('Aguardando badges de preço aparecerem na tabela...');
        await page.waitForSelector('table tbody tr td .badge', { timeout: 30000 });

        log('Clicando para ordenar por Econômica (Menor Preço)...');
        const sortBtn = 'span[aria-label^="Econômica"]';
        await page.waitForSelector(sortBtn);
        await page.click(sortBtn);
        
        log('Aguardando 3s para a reordenação da tabela...');
        await delay(3000);

        log('Iniciando extração dos dados da tabela...');
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

        log(`Sucesso! ${flightsData.length} voos encontrados.`);

        if (flightsData.length > 0) {
            log('Abrindo modal do voo mais barato para extrair links de reserva...');
            const buttons = await page.$$('button.open-modal-btn');
            if (buttons[0]) {
                await buttons[0].click();
                await delay(3000);
                
                log('Extraindo links do dropdown de reserva...');
                flightsData[0].links_reserva = await page.$$eval('#bookingOptions a.dropdown-item', els =>
                    els.map(el => ({ parceiro: el.textContent.trim(), url: el.href }))
                );
            }
        }

        log('Fechando navegador e retornando resultados.');
        await browser.close();
        return { result: flightsData };

    } catch (error) {
        log(`ERRO CRÍTICO: ${error.message}`);
        throw error;
    }
};

module.exports = { scrapeFlights };