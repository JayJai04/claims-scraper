import { getDb, insertFullClaims, closeDb, listClaims } from './src/lib/db.ts';
import { scrapeAllFullClaims } from './src/lib/scraper.ts';

async function main() {
  getDb();
  const existing = listClaims();
  if (existing.length > 0) {
    console.log('DB already has', existing.length, 'claims. Skipping scrape.');
  } else {
    console.log('Scraping all claims...');
    const fulls = await scrapeAllFullClaims();
    console.log('Scraped:', fulls.length, 'full claims');
    console.log('Insert:', insertFullClaims(fulls));
  }
  closeDb();
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
