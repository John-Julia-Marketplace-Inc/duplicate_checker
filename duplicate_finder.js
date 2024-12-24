const axios = require('axios');
const csv = require('csv-parser');
const Shopify = require('shopify-api-node');
// require('dotenv').config();
const stream = require('stream');
const { promisify } = require('util');
const fs = require('fs');

const logFile = fs.createWriteStream(`${process.env.OUT_FOLDER}/logs.log`, { flags: 'a' });
const pipeline = promisify(stream.pipeline);

const shopify = new Shopify({
    shopName: process.env.SHOP,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
});

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
        logFile(`Error fetching products: ${error}`);
    }
    return products;
}

const fetchProductBySku = async (sku) => {
    try {
        // GraphQL query to fetch products by SKU
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
            console.error('GraphQL Errors:', response.errors);
            return 0; 
        }

        const products = response.products.edges;

        if (products.length === 0) {
            return 0;
        }

        // Count how many products with this SKU exist
        let productIdCount = 0;

        products.forEach((product) => {
            // Check if the product's variants contain the matching SKU
            const hasMatchingSku = product.node.variants.edges.some((variant) => variant.node.sku === sku);

            // Increment count if the product contains the SKU
            if (hasMatchingSku) {
                productIdCount += 1;
            }
        });

        return productIdCount;

    } catch (error) {
        console.error('Error fetching product by SKU:', error);
        return 0; 
    }
};

async function checkAllSkus(link, outfile) {
    const products = await fetch_csv_products(link);

    const duplicateSkus = [];
    let skuColumn = "SKU"; // Default column to check

    // Check if the first product contains "Variant SKU" to decide which column to use
    if (products[0].hasOwnProperty("Variant SKU")) {
        skuColumn = "Variant SKU";
    }

    // Iterate through the CSV and check each SKU against Shopify
    for (const product of products) {
        const sku = product[skuColumn];

        if (!sku) {
            logFile('No matching SKU found in the CSV.');
            break;
        }

        const skuCount = await fetchProductBySku(sku);
        
        if (skuCount > 1) {
            logFile(`Duplicate found: SKU ${sku} has ${skuCount} entries in Shopify.`);
            duplicateSkus.push({ sku, count: skuCount });
        }
        
    }

    // Save the results to a new CSV file
    const csvStream = fs.createWriteStream(outfile);
    csvStream.write('SKU,Count\n'); 

    duplicateSkus.forEach(item => {
        csvStream.write(`${item.sku},${item.count}\n`); // Write each SKU and its count
    });

    csvStream.end();
}

// Start the process
checkAllSkus(process.env.IN_FILE, `${process.env.OUT_FOLDER}/duplicate_skus.csv`);
