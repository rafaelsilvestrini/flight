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

        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const searchUrl = `https://seats.aero/search?min_seats=1&applicable_cabin=any&additional_days=true&additional_days_num=${days}&max_fees=40000&date=${departureDate}&origins=${origin}&destinations=${destination}`;

        log(`Navegando para: ${searchUrl}`);
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        log('Aguardando carregamento e estabilização (20s)...');
        await delay(20000); 

        if (debug) {
            await page.screenshot({ path: 'vps_debug.png', fullPage: true });
            log('Screenshot de debug salva.');
        }

        log('Verificando presença da tabela...');
        await page.waitForSelector('.dt-column-title', { timeout: 60000 });

        // --- ORDENAÇÃO POR CABEÇALHO ESPECÍFICO ---
        log('Tentando ordenar por Econômica...');
        try {
            const clicked = await page.evaluate(() => {
                // Busca especificamente o span que contém o título "Econômica"
                const titles = Array.from(document.querySelectorAll('.dt-column-title'));
                const econSpan = titles.find(el => el.innerText.trim() === 'Econômica');
                
                if (econSpan) {
                    // Clica no cabeçalho TH mais próximo que contém esse título
                    const parentTh = econSpan.closest('th');
                    if (parentTh) {
                        parentTh.click();
                        return true;
                    }
                }
                return false;
            });

            if (clicked) {
                log('Clique de ordenação realizado. Aguardando processamento da tabela...');
                await delay(6000); // 6 segundos para a VPS reordenar a lista
            } else {
                log('ERRO: Cabeçalho "Econômica" não localizado na estrutura DOM.');
            }
        } catch (e) {
            log(`Falha na ordenação: ${e.message}`);
        }
        // ------------------------------------------

        log('Extraindo dados finais...');
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
            log('Extraindo links de reserva do voo no topo da lista...');
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
        log(`ERRO NO PROCESSO: ${error.message}`);
        if (browser) await browser.close();
        throw error;
    }
};

module.exports = { scrapeFlights };