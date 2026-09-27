CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE item_type AS ENUM ('armor', 'weapon', 'backpack');
CREATE TYPE rarity_type AS ENUM ('common', 'uncommon', 'rare', 'epic', 'legendary');
CREATE TYPE equip_slot AS ENUM ('helmet', 'chest', 'legs', 'weapon', 'backpack');
CREATE TYPE trade_status AS ENUM ('pending', 'confirmed', 'completed', 'cancelled');
CREATE TYPE listing_status AS ENUM ('active', 'sold', 'cancelled');
CREATE TYPE report_status AS ENUM ('open', 'reviewed', 'dismissed');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nickname VARCHAR(16) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
    is_premium BOOLEAN NOT NULL DEFAULT FALSE,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    premium_until TIMESTAMPTZ,
    cases_opened INTEGER NOT NULL DEFAULT 0,
    total_value BIGINT NOT NULL DEFAULT 0,
    reports_count INTEGER NOT NULL DEFAULT 0,
    kicked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT nickname_format CHECK (nickname ~ '^[A-Za-z0-9_]{3,16}$')
);

CREATE TABLE skins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(64) NOT NULL,
    applies_to item_type NOT NULL,
    rarity rarity_type NOT NULL,
    color VARCHAR(32),
    pattern VARCHAR(64),
    particles VARCHAR(64),
    animation VARCHAR(64),
    glow BOOLEAN NOT NULL DEFAULT FALSE,
    price BIGINT NOT NULL DEFAULT 0 CHECK (price >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(64) NOT NULL,
    price BIGINT NOT NULL DEFAULT 0 CHECK (price >= 0),
    icon_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE case_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    item_template_id UUID NOT NULL,
    drop_weight NUMERIC(10,4) NOT NULL CHECK (drop_weight > 0)
);

CREATE TABLE item_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(64) NOT NULL,
    type item_type NOT NULL,
    level SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 10),
    rarity rarity_type NOT NULL,
    base_stats JSONB NOT NULL DEFAULT '{}'::JSONB,
    icon_url TEXT,
    model_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT rarity_level_match CHECK (
        (rarity = 'common' AND level BETWEEN 1 AND 3) OR
        (rarity = 'uncommon' AND level BETWEEN 4 AND 5) OR
        (rarity = 'rare' AND level BETWEEN 6 AND 7) OR
        (rarity = 'epic' AND level BETWEEN 8 AND 9) OR
        (rarity = 'legendary' AND level = 10)
    )
);

ALTER TABLE case_items
    ADD CONSTRAINT fk_case_items_template
    FOREIGN KEY (item_template_id) REFERENCES item_templates(id) ON DELETE CASCADE;

CREATE TABLE items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES item_templates(id),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skin_id UUID REFERENCES skins(id),
    type item_type NOT NULL,
    level SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 10),
    rarity rarity_type NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_items_owner ON items(owner_id);
CREATE INDEX idx_items_template ON items(template_id);

CREATE TABLE equipped (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    helmet UUID REFERENCES items(id) ON DELETE SET NULL,
    chest UUID REFERENCES items(id) ON DELETE SET NULL,
    legs UUID REFERENCES items(id) ON DELETE SET NULL,
    weapon UUID REFERENCES items(id) ON DELETE SET NULL,
    backpack UUID REFERENCES items(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE case_openings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    case_id UUID NOT NULL REFERENCES cases(id),
    item_id UUID NOT NULL REFERENCES items(id),
    was_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_case_openings_user ON case_openings(user_id);

CREATE TABLE market_listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    buyer_id UUID REFERENCES users(id),
    price BIGINT NOT NULL CHECK (price > 0),
    commission_pct NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    status listing_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sold_at TIMESTAMPTZ
);

CREATE INDEX idx_market_status ON market_listings(status);
CREATE INDEX idx_market_seller ON market_listings(seller_id);

CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    initiator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    initiator_currency BIGINT NOT NULL DEFAULT 0 CHECK (initiator_currency >= 0),
    recipient_currency BIGINT NOT NULL DEFAULT 0 CHECK (recipient_currency >= 0),
    initiator_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    recipient_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    status trade_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT different_users CHECK (initiator_id <> recipient_id)
);

CREATE TABLE trade_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    from_user_id UUID NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_trade_items_trade ON trade_items(trade_id);

CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status report_status NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT different_report_users CHECK (reporter_id <> reported_id)
);

CREATE INDEX idx_reports_reported ON reports(reported_id);

CREATE TABLE daily_rewards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL CHECK (amount >= 0),
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, claimed_at)
);

CREATE INDEX idx_daily_rewards_user ON daily_rewards(user_id);

CREATE TABLE logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_logs_user ON logs(user_id);
CREATE INDEX idx_logs_action ON logs(action);
CREATE INDEX idx_logs_created ON logs(created_at);
