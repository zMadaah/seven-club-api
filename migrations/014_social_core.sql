-- 014_social_core.sql
-- Núcleo do feed social: posts (opcionalmente ligados a uma atividade),
-- fotos, curtidas, comentários (com resposta a comentário) e seguir/
-- seguidores. "Grupos" (is_group) fica como coluna pronta mas sempre
-- FALSE por enquanto — depende do Crew, que ainda não existe.

ALTER TABLE app_users
  ADD COLUMN level         INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN location      VARCHAR(150),
  ADD COLUMN country_code  VARCHAR(2);

CREATE TABLE posts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  -- Ligação opcional com uma atividade real (distância/duração/pace/
  -- território do post vêm daqui quando presente). O CreatePost de hoje
  -- não oferece essa escolha ainda — é caption + fotos só — mas o schema
  -- já fica pronto pra quando isso existir.
  activity_id    UUID REFERENCES activities(id) ON DELETE SET NULL,
  activity_type  VARCHAR(10) NOT NULL DEFAULT 'run' CHECK (activity_type IN ('run', 'ride')),
  title          VARCHAR(150),
  caption        TEXT,
  is_group       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_posts_activity_id ON posts(activity_id);

CREATE TABLE post_photos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id   UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  url       TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_post_photos_post_id ON post_photos(post_id);

CREATE TABLE post_likes (
  post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE post_comments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id            UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  parent_comment_id  UUID REFERENCES post_comments(id) ON DELETE CASCADE,
  body               TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_post_comments_post_id ON post_comments(post_id);

CREATE TABLE follows (
  follower_id  UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  followee_id  UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT chk_no_self_follow CHECK (follower_id <> followee_id)
);

CREATE INDEX idx_follows_followee ON follows(followee_id);
