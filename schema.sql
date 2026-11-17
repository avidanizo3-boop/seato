PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS customers (
 customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
 full_name TEXT NOT NULL,
 phone TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS restaurants (
 restaurant_id INTEGER PRIMARY KEY,
 name TEXT NOT NULL,
 city TEXT NOT NULL,
 cuisine TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS restaurant_tables (
 table_id INTEGER PRIMARY KEY,
 restaurant_id INTEGER NOT NULL REFERENCES restaurants(restaurant_id),
 table_number INTEGER NOT NULL,
 capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 50),
 UNIQUE(restaurant_id,table_number)
);
CREATE TABLE IF NOT EXISTS reservations (
 reservation_id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
 table_id INTEGER NOT NULL REFERENCES restaurant_tables(table_id),
 start_at TEXT NOT NULL,
 end_at TEXT NOT NULL,
 party_size INTEGER NOT NULL CHECK(party_size BETWEEN 1 AND 12),
 status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled')),
 CHECK(end_at > start_at)
);
CREATE INDEX IF NOT EXISTS idx_reservation_availability ON reservations(table_id,start_at,end_at,status);
