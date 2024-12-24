const axios = require('axios');
const csv = require('csv-parser');
const Shopify = require('shopify-api-node');
// require('dotenv').config();
const stream = require('stream');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const logFile = fs.createWriteStream(`${process.env.OUT_FOLDER}/logs.log`, { flags: 'a' });
const pipeline = promisify(stream.pipeline);

const shopify = new Shopify({
    shopName: process.env.SHOP,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
});

function logMessage(message) {
    const timestamp = new Date().toISOString();
    logFile.write(`[${timestamp}] ${message}\n`);
}

// Check and create output file or folder
function ensureOutputFile(outputFilePath) {
    const outputDir = path.dirname(outputFilePath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
        logMessage(`Output directory created: ${outputDir}`);
    }
    if (!fs.existsSync(outputFilePath)) {
        fs.writeFileSync(outputFilePath, '');
        logMessage(`Output file created: ${outputFilePath}`);
    }
}

async function fetch_csv_products(link) {
    const products = [];
    try {
        await pipeline(
            fs.createReadStream(link),
            csv(),
            new stream.Writable({
                objectMode: true,
                write(product, encoding, callback) {
                    products.push(product);
                    callback();
                }
            })
        );
    } catch (error) {
        logMessage(`Error fetching products: ${error}`);
    }
    return products;
}

const fetchProductBySku = async (sku) => {
    try {
        const query = `
        {
            products(first: 100, query: "sku:${sku}") {
                edges {
                    node {
                        id
                        title
                        variants(first: 100) {
                            edges {
                                node {
                                    sku
                                }
                            }
                        }
                    }
                }
            }
        }`;

        const response = await shopify.graphql(query);

        if (response.errors) {
            logMessage(`GraphQL Errors: ${JSON.stringify(response.errors)}`);
            return 0; 
        }

        const products = response.products.edges;

        if (products.length === 0) {
            return 0;
        }

        let productIdCount = 0;

        products.forEach((product) => {
            const hasMatchingSku = product.node.variants.edges.some((variant) => variant.node.sku === sku);
            if (hasMatchingSku) {
                productIdCount += 1;
            }
        });

        return productIdCount;

    } catch (error) {
        logMessage(`Error fetching product by SKU: ${error}`);
        return 0; 
    }
};

async function checkAllSkus(link, outfile) {
    ensureOutputFile(process.env.OUT_FILE);

    const products = await fetch_csv_products(link);

    const duplicateSkus = [];
    let skuColumn = "SKU"; 

    if (products[0].hasOwnProperty("Variant SKU")) {
        skuColumn = "Variant SKU";
    }

    for (const product of products) {
        const sku = product[skuColumn];

        if (!sku) {
            logMessage('No matching SKU found in the CSV.');
            break;
        }

        const skuCount = await fetchProductBySku(sku);
        
        if (skuCount > 1) {
            logMessage(`Duplicate found: SKU ${sku} has ${skuCount} entries in Shopify.`);
            duplicateSkus.push({ sku, count: skuCount });
        }
    }

    const csvStream = fs.createWriteStream(outfile);
    csvStream.write('SKU,Count\n'); 

    duplicateSkus.forEach(item => {
        csvStream.write(`${item.sku},${item.count}\n`);
    });

    csvStream.end();
}

// Start the process
checkAllSkus(process.env.IN_FILE, `${process.env.OUT_FILE}/duplicate_skus.csv`);
