
CREATE DATABASE IF NOT EXISTS flashguard
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;

USE flashguard;

CREATE TABLE IF NOT EXISTS products (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    product_name VARCHAR(150) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    stock INT UNSIGNED NOT NULL,
    sale_status ENUM('UPCOMING', 'ACTIVE', 'CLOSED')
        NOT NULL DEFAULT 'UPCOMING',
    PRIMARY KEY (id),
    CONSTRAINT chk_product_price CHECK (price >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS checkout_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    idempotency_key VARCHAR(128) NOT NULL,
    product_id BIGINT UNSIGNED NOT NULL,
    request_status ENUM(
        'PROCESSING', 'CONFIRMED', 'SOLD_OUT', 'UNAVAILABLE'
    ) NOT NULL DEFAULT 'PROCESSING',
    order_id BIGINT UNSIGNED DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_checkout_idempotency (idempotency_key),
    KEY idx_checkout_product (product_id),
    KEY idx_checkout_status_created (request_status, created_at),
    KEY fk_checkout_order (order_id),
    CONSTRAINT fk_checkout_product
        FOREIGN KEY (product_id) REFERENCES products (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    product_id BIGINT UNSIGNED NOT NULL,
    quantity INT UNSIGNED NOT NULL DEFAULT 1,
    order_status ENUM('CONFIRMED', 'CANCELLED')
        NOT NULL DEFAULT 'CONFIRMED',
    idempotency_key VARCHAR(128) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_order_idempotency (idempotency_key),
    KEY idx_orders_product_status (product_id, order_status),
    CONSTRAINT fk_order_checkout_key
        FOREIGN KEY (idempotency_key)
        REFERENCES checkout_requests (idempotency_key),
    CONSTRAINT fk_order_product
        FOREIGN KEY (product_id) REFERENCES products (id),
    CONSTRAINT chk_order_quantity CHECK (quantity = 1)
) ENGINE=InnoDB;

ALTER TABLE checkout_requests
    ADD CONSTRAINT fk_checkout_order
    FOREIGN KEY (order_id) REFERENCES orders (id);
