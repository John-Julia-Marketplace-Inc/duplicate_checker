const axios = require('axios');
const csv = require('csv-parser');
const Shopify = require('shopify-api-node');
require('dotenv').config();
const stream = require('stream');
const { promisify } = require('util');
const fs = require('fs');

const pipeline = promisify(stream.pipeline);

const shopify = new Shopify({
    shopName: process.env.SHOP,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
});

// Fetch product details by SKU
const fetchProductBySku = async (sku) => {
    const query = `
    {
        products(first: 100, query: "sku:${sku}") {
            edges {
                node {
                    id
                    title
                    descriptionHtml
                    status
                    updatedAt
                    publishedAt
                    variants(first: 100) {
                        edges {
                            node {
                                id
                                sku
                                price
                                inventoryQuantity
                            }
                        }
                    }
                }
            }
        }
    }`;

    try {
        const response = await shopify.graphql(query);

        if (response.errors) {
            console.error('GraphQL Errors:', response.errors);
            return [];
        }

        return response.products.edges.map(edge => edge.node);
    } catch (error) {
        console.error('Error fetching product by SKU:', error);
        return [];
    }
};

// Determine the best product to retain
// const selectBestProduct = (products) => {
//     return products.reduce((best, product) => {
//         const isMoreComplete =
//             product.title && product.descriptionHtml &&
//             product.variants.length > 0;

//         const isActive = !!product.publishedAt;

//         // Compare by completeness and active status
//         if (isMoreComplete || isActive) {
//             return product;
//         }

//         // If neither is more complete or active, prefer the most recently updated product
//         if (new Date(product.publishedAt) < new Date(best.publishedAt)) {
//             return product;
//         }

//         return best;
//     }, products[0]);
// };


const selectBestProduct = (products) => {
    return products.reduce((best, product) => {
        // Ensure the product is active
        const isActive = product.status === 'ACTIVE';

        const isMoreComplete =
            product.title && product.descriptionHtml &&
            product.variants.length > 0;

        // If the current product is active and more complete, select it
        if (isActive) {
            if (isMoreComplete) {
                return product;
            }

            return product;
        }

        // If neither is more complete or active, prefer the most recently updated product
        if (
            new Date(product.publishedAt) > new Date(best.publishedAt) &&
            product.status === 'active'
        ) {
            return product;
        }

        return best;
    }, products[0]);
};

// Delete product by ID
const deleteProductById = async (productId) => {
    const mutation = `
    mutation {
        productDelete(input: { id: "${productId}" }) {
            deletedProductId
            userErrors {
                field
                message
            }
        }
    }`;
    console.log('To delete:', productId)
    try {
        const response = await shopify.graphql(mutation);

        if (response.errors) {
            console.error('GraphQL Errors:', response.errors);
        } else {
            console.log(`Deleted product with ID: ${productId}`);
        }
    } catch (error) {
        console.error('Error deleting product:', error);
    }
};

// Main function to process duplicates and retain the best product
async function processDuplicates(link) {
    const products = await fetch_csv_products(link);

    const checkedSkus = new Set();

    for (const product of products) {
        const sku = product['SKU'];

        // Skip SKUs that are already processed
        if (checkedSkus.has(sku)) continue;
        checkedSkus.add(sku);

        const skuProducts = await fetchProductBySku(sku);

        console.log('skuProducts:', skuProducts)

        if (skuProducts.length > 1) {
            console.log(`Processing duplicate SKU: ${sku}`);

            const bestProduct = selectBestProduct(skuProducts);

            // Delete other duplicate products
            for (const product of skuProducts) {
                if (product.id !== bestProduct.id) {
                    await deleteProductById(product.id);
                }
            }

        }
    }

    console.log('Duplicate processing complete.');
}

// CSV Fetcher
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
        console.log(`Error fetching products: ${error}`);
    }
    return products;
}

// Start the process
processDuplicates('data2/duplicates_bags_skus.csv');
