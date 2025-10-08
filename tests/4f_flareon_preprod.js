import http from "k6/http";
import { check, group, sleep } from "k6";

const API_URL = "https://4f-flareon-preprod.goodylabs.com";
const STORE = "default";

const REGISTERED_EMAIL = "john.paul.secondus@gmail.com";
const REGISTERED_PASSWORD = "1q2w3e4rQ";

const ANON_EMAIL = "irrelevant@email.com";

export let options = {
    scenarios: {
        registered_customer_checkout: {
            executor: "per-vu-iterations",
            vus: 50,
            iterations: 3,
            exec: "registeredCheckout",
        },
        anonymous_customer_checkout: {
            executor: "per-vu-iterations",
            vus: 50,
            iterations: 3,
            exec: "anonymousCheckout",
        },
    },
    cloud: {
        projectID: 3786476,
        name: "Flareon preprod",
        distribution: {
            london: { loadZone: "amazon:gb:london", percent: 100 },
        },
    },
};

// Helper function to run separate status and timing checks
function taggedCheck(res, name) {
    check(res, {
        [`${name} - status 200`]: (r) => r.status === 200,
        [`${name} - response time < 800ms`]: (r) => r.timings.duration < 800,
    });
}

export function registeredCheckout() {
    let customerToken = "";
    let cartId = "";
    let parentSku = "";
    let variantSku = "";

    group("1. Registered user sign in", () => {
        console.log("[AUTH] Signing in registered user:", REGISTERED_EMAIL);
        const res = http.post(
            `${API_URL}/customers/token`,
            JSON.stringify({
                email: REGISTERED_EMAIL,
                password: REGISTERED_PASSWORD,
            }),
            { headers: { "Content-Type": "application/json", store: STORE } },
        );

        if (res.status !== 200) {
            console.error(`[AUTH] Sign in failed: ${res.status}, ${res.body}`);
        }
        taggedCheck(res, "[AUTH] Sign in");

        customerToken = res.json("data.token");
        console.log(
            "[AUTH] Received customer token:",
            customerToken ?? "(none)",
        );
    });

    group("2. [AUTH] Create cart", () => {
        const res = http.post(`${API_URL}/cart`, null, {
            headers: {
                store: STORE,
                Authorization: `Bearer ${customerToken}`,
            },
        });

        if (res.status !== 200) {
            console.error(
                `[AUTH] Cart creation failed: ${res.status}, ${res.body}`,
            );
        }
        taggedCheck(res, "[AUTH] Create cart");

        cartId = res.json("data");
        console.log("[AUTH] Created cart ID:", cartId);
    });

    group("3. [AUTH] Find product to buy", () => {
        const res = http.get(`${API_URL}/e-products`, {
            headers: {
                "fl-build-version": "123",
                "fl-platform": "Android",
                store: STORE,
                Authorization: `Bearer ${customerToken}`,
            },
        });

        console.log(`[AUTH] Products fetch status: ${res.status}`);

        if (res.status !== 200) {
            console.error(
                `[AUTH] Failed to get products: ${res.status}, ${res.body}`,
            );
            throw new Error(
                `[AUTH] Failed to get products, status: ${res.status}`,
            );
        }

        taggedCheck(res, "[AUTH] Get products");

        const data = res.json("data");
        console.log(`[AUTH] Fetched ${data?.items?.length ?? 0} products`);
        if (!data || !data.items || data.items.length === 0) {
            console.error(
                "[AUTH] No products found in response body: ",
                res.body,
            );
            throw new Error("[AUTH] No products returned from API");
        }

        const product = data.items[0];
        console.log(
            `[AUTH] Selected product SKU: ${product.sku}, Stock status: ${product.stock_status}`,
        );

        check(product, {
            "[AUTH] product is in stock": (p) => p.stock_status === "IN_STOCK",
        }) ||
            console.error(
                `[AUTH] Product ${product.sku} not in stock: ${product.stock_status}`,
            );

        if (product.stock_status !== "IN_STOCK") {
            throw new Error("[AUTH] Selected product is not in stock");
        }

        let firstVariantWithStock = null;
        const variants = product.variants;
        if (Array.isArray(variants) && variants.length > 0) {
            for (let i = 0; i < variants.length; i++) {
                if (variants[i].product.stock_available_qty > 40) {
                    firstVariantWithStock = variants[i];
                    break;
                }
            }
        } else {
            console.warn("[AUTH] No variants array found on product");
            firstVariantWithStock = product;
        }

        if (!firstVariantWithStock) {
            console.error("[AUTH] No variant with available stock found");
            throw new Error("[AUTH] No variant with stock available");
        }

        parentSku = product.sku;
        variantSku = firstVariantWithStock.product
            ? firstVariantWithStock.product.sku
            : firstVariantWithStock.sku || product.sku;

        console.log(
            `[AUTH] Using parentSku: ${parentSku}, variantSku: ${variantSku}`,
        );
    });

    group("4. [AUTH] Add item to cart", () => {
        const body = JSON.stringify({
            parentSku,
            sku: variantSku,
            quantity: 1,
        });
        console.log(
            `[AUTH] Adding product SKU ${variantSku} to cart ${cartId} with body:`,
            body,
        );

        const res = http.patch(`${API_URL}/cart/${cartId}`, body, {
            headers: {
                store: STORE,
                Authorization: `Bearer ${customerToken}`,
                "Content-Type": "application/json",
            },
        });

        console.log(`[AUTH] Add to cart response status: ${res.status}`);

        if (res.status !== 200) {
            console.error("[AUTH] Add to cart failed: ", res.body);
        }

        taggedCheck(res, "[AUTH] Add to cart");
    });

    const addressPayload = {
        address: {
            region: "PL",
            country_code: "PL",
            street: ["Piotrkowska 21"],
            telephone: "371501501",
            postcode: "90-001",
            city: "Łódź",
            firstname: "John",
            lastname: "Paul",
            save_in_address_book: false,
        },
        useForShipping: false,
    };

    group("5. [AUTH] Set billing address", () => {
        console.log(`[AUTH] Setting billing address for cart ID ${cartId}`);
        const body = JSON.stringify(addressPayload);
        const res = http.post(
            `${API_URL}/cart/${cartId}/set_billing_address`,
            body,
            {
                headers: {
                    store: STORE,
                    Authorization: `Bearer ${customerToken}`,
                    "Content-Type": "application/json",
                },
            },
        );
        console.log(
            `[AUTH] Set billing address response status: ${res.status}`,
        );

        if (res.status !== 200) {
            console.error("[AUTH] Set billing address failed: ", res.body);
        }

        taggedCheck(res, "[AUTH] Set billing address");
    });

    group("6. [AUTH] Set shipping address", () => {
        const shippingAddress = { address: addressPayload.address };
        const body = JSON.stringify(shippingAddress);
        console.log(`[AUTH] Setting shipping address for cart ID ${cartId}`);
        const res = http.post(
            `${API_URL}/cart/${cartId}/set_shipping_address`,
            body,
            {
                headers: {
                    store: STORE,
                    Authorization: `Bearer ${customerToken}`,
                    "Content-Type": "application/json",
                },
            },
        );
        console.log(
            `[AUTH] Set shipping address response status: ${res.status}`,
        );

        if (res.status !== 200) {
            console.error("[AUTH] Set shipping address failed: ", res.body);
        }

        taggedCheck(res, "[AUTH] Set shipping address");
    });

    group("7. [AUTH] Set shipping method", () => {
        const body = JSON.stringify({
            carrierCode: "owsh1",
            methodCode: "dpd",
        });
        console.log(
            `[AUTH] Setting shipping method for cart ID ${cartId} with body: ${body}`,
        );
        const res = http.post(
            `${API_URL}/cart/${cartId}/set_shipping_method`,
            body,
            {
                headers: {
                    store: STORE,
                    Authorization: `Bearer ${customerToken}`,
                    "Content-Type": "application/json",
                },
            },
        );
        console.log(
            `[AUTH] Set shipping method response status: ${res.status}`,
        );

        if (res.status !== 200) {
            console.error("[AUTH] Set shipping method failed: ", res.body);
        }

        taggedCheck(res, "[AUTH] Set shipping method");
    });

    group("8. [AUTH] Set payment method", () => {
        const paymentPayload = {
            methodCode: "payu_gateway",
            is_invoice: false,
            payu_gateway: {
                payu_method: "blik",
                payu_method_type: "PBL",
            },
        };
        console.log(
            `[AUTH] Setting payment method for cart ID ${cartId} with payload:`,
            JSON.stringify(paymentPayload),
        );
        const res = http.post(
            `${API_URL}/cart/${cartId}/set_payment_method`,
            JSON.stringify(paymentPayload),
            {
                headers: {
                    store: STORE,
                    Authorization: `Bearer ${customerToken}`,
                    "Content-Type": "application/json",
                },
            },
        );
        console.log(`[AUTH] Set payment method response status: ${res.status}`);

        if (res.status !== 200) {
            console.error("[AUTH] Set payment method failed: ", res.body);
        }

        taggedCheck(res, "[AUTH] Set payment method");
    });

    sleep(1);
}

export function anonymousCheckout() {
    let cartId = "";
    let parentSku = "";
    let variantSku = "";

    group("1. [ANON] Create cart", () => {
        console.log("[ANON] Creating cart for anonymous user");
        const res = http.post(`${API_URL}/cart`, null, {
            headers: { store: STORE },
        });
        console.log(`[ANON] Create cart response status: ${res.status}`);

        if (res.status !== 200) {
            console.error(
                "[ANON] Cart creation failed for anonymous user: ",
                res.body,
            );
        }

        taggedCheck(res, "[ANON] Create cart");

        cartId = res.json("data");
        console.log("[ANON] Created anonymous cart ID:", cartId);
    });

    group("2. [ANON] Find product to buy", () => {
        console.log("[ANON] Fetching product list for anonymous user");
        const res = http.get(`${API_URL}/e-products`, {
            headers: {
                "fl-build-version": "123",
                "fl-platform": "Android",
                store: STORE,
            },
        });
        console.log(`[ANON] Products fetch status: ${res.status}`);

        if (res.status !== 200) {
            console.error("[ANON] Failed to get products: ", res.body);
            throw new Error(
                `[ANON] Failed to get products, status: ${res.status}`,
            );
        }

        taggedCheck(res, "[ANON] Get products");

        const data = res.json("data");
        console.log(`[ANON] Fetched ${data?.items?.length ?? 0} products`);
        if (!data || !data.items || data.items.length === 0) {
            console.error(
                "[ANON] No products found in response body: ",
                res.body,
            );
            throw new Error("[ANON] No products returned from API");
        }

        const product = data.items[0];
        console.log(
            `[ANON] Selected product SKU: ${product.sku}, Stock status: ${product.stock_status}`,
        );

        check(product, {
            "[ANON] product is in stock": (p) => p.stock_status === "IN_STOCK",
        }) ||
            console.error(
                `[ANON] Product ${product.sku} not in stock: ${product.stock_status}`,
            );

        if (product.stock_status !== "IN_STOCK") {
            throw new Error("[ANON] Selected product is not in stock");
        }

        let firstVariantWithStock = null;
        const variants = product.variants;
        if (Array.isArray(variants) && variants.length > 0) {
            for (let i = 0; i < variants.length; i++) {
                if (variants[i].product.stock_available_qty > 40) {
                    firstVariantWithStock = variants[i];
                    break;
                }
            }
        } else {
            console.warn("[ANON] No variants array found on product");
            firstVariantWithStock = product;
        }

        if (!firstVariantWithStock) {
            console.error("[ANON] No variant with available stock found");
            throw new Error("[ANON] No variant with stock available");
        }

        parentSku = product.sku;
        variantSku = firstVariantWithStock.product
            ? firstVariantWithStock.product.sku
            : firstVariantWithStock.sku || product.sku;

        console.log(
            `[ANON] Using parentSku: ${parentSku}, variantSku: ${variantSku}`,
        );
    });

    group("3. [ANON] Add item to cart", () => {
        const body = JSON.stringify({
            parentSku,
            sku: variantSku,
            quantity: 1,
        });
        console.log(
            `[ANON] Adding SKU ${variantSku} to cart ${cartId} with body:`,
            body,
        );

        const res = http.patch(`${API_URL}/cart/${cartId}`, body, {
            headers: { store: STORE, "Content-Type": "application/json" },
        });
        console.log(`[ANON] Add to cart response status: ${res.status}`);

        if (res.json().status !== "success") {
            console.error("[ANON] Add to cart failed: ", res.body);
        }

        taggedCheck(res, "[ANON] Add to cart");
    });

    const addressPayload = {
        address: {
            region: "PL",
            country_code: "PL",
            street: ["Piotrkowska 120"],
            telephone: "501501501",
            postcode: "90-001",
            city: "Łódź",
            firstname: "John",
            lastname: "Doe",
            save_in_address_book: false,
        },
        useForShipping: false,
    };

    group("4. [ANON] Set billing address", () => {
        console.log(
            `[ANON] Setting billing address for anonymous cart ID ${cartId}`,
        );
        const body = JSON.stringify(addressPayload);
        const res = http.post(
            `${API_URL}/cart/${cartId}/set_billing_address`,
            body,
            {
                headers: { store: STORE, "Content-Type": "application/json" },
            },
        );
        console.log(
            `[ANON] Set billing address response status: ${res.status}`,
        );

        if (res.status !== 200) {
            console.error("[ANON] Set billing address failed: ", res.body);
        }

        taggedCheck(res, "[ANON] Set billing address");
    });

    group("5. [ANON] Set shipping address", () => {
        const shippingAddress = { address: addressPayload.address };
        const body = JSON.stringify(shippingAddress);
        console.log(
            `[ANON] Setting shipping address for anonymous cart ID ${cartId}`,
        );
        const res = http.post(
            `${API_URL}/cart/${cartId}/set_shipping_address`,
            body,
            {
                headers: { store: STORE, "Content-Type": "application/json" },
            },
        );
        console.log(
            `[ANON] Set shipping address response status: ${res.status}`,
        );

        if (res.status !== 200) {
            console.error("[ANON] Set shipping address failed: ", res.body);
        }

        taggedCheck(res, "[ANON] Set shipping address");
    });

    group("6. [ANON] Set shipping method", () => {
        const body = JSON.stringify({
            carrierCode: "owsh1",
            methodCode: "dpd",
        });
        console.log(
            `[ANON] Setting shipping method for anonymous cart ID ${cartId} with body: ${body}`,
        );
        const res = http.post(
            `${API_URL}/cart/${cartId}/set_shipping_method`,
            body,
            {
                headers: { store: STORE, "Content-Type": "application/json" },
            },
        );
        console.log(
            `[ANON] Set shipping method response status: ${res.status}`,
        );

        if (res.status !== 200) {
            console.error("[ANON] Set shipping method failed: ", res.body);
        }

        taggedCheck(res, "[ANON] Set shipping method");
    });

    group("7. [ANON] Set payment method", () => {
        const paymentPayload = {
            methodCode: "payu_gateway",
            is_invoice: false,
            payu_gateway: {
                payu_method: "blik",
                payu_method_type: "PBL",
            },
        };
        console.log(
            `[ANON] Setting payment method for anonymous cart ID ${cartId} with payload:`,
            JSON.stringify(paymentPayload),
        );
        const res = http.post(
            `${API_URL}/cart/${cartId}/set_payment_method`,
            JSON.stringify(paymentPayload),
            {
                headers: { store: STORE, "Content-Type": "application/json" },
            },
        );
        console.log(`[ANON] Set payment method response status: ${res.status}`);

        if (res.status !== 200) {
            console.error("[ANON] Set payment method failed: ", res.body);
        }

        taggedCheck(res, "[ANON] Set payment method");
    });

    group("8. [ANON] Set guest email", () => {
        const body = JSON.stringify({ email: ANON_EMAIL });
        console.log(
            `[ANON] Setting guest email for anonymous cart ID ${cartId} to: ${ANON_EMAIL}`,
        );
        const res = http.post(
            `${API_URL}/cart/${cartId}/set_guest_email`,
            body,
            {
                headers: { store: STORE, "Content-Type": "application/json" },
            },
        );
        console.log(`[ANON] Set guest email response status: ${res.status}`);

        if (res.status !== 200) {
            console.error("[ANON] Set guest email failed: ", res.body);
        }

        taggedCheck(res, "[ANON] Set guest email");
    });

    sleep(1);
}
