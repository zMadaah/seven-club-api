-- 020_anonymous_mode_notification_prefs.sql

ALTER TABLE app_users
  ADD COLUMN anonymous_mode BOOLEAN NOT NULL DEFAULT FALSE;

-- JSONB em vez de 16 colunas: esse é um "saco de preferências" que tende
-- a crescer/mudar junto com os tipos de notificação que o app for
-- ganhando — um campo só é bem mais fácil de estender do que migration
-- nova a cada notificação nova. Os defaults abaixo espelham exatamente
-- DEFAULT_NOTIFICATION_PREFERENCES do app (types/notificationPreference.ts).
ALTER TABLE app_users
  ADD COLUMN notification_preferences JSONB NOT NULL DEFAULT '{
    "heartedActivity": true,
    "heartedStatus": true,
    "commentOnActivity": true,
    "commentOnStatus": true,
    "repliedToComment": true,
    "followingYou": true,
    "followRequest": true,
    "questionAnswered": true,
    "privateLobbyInvite": true,
    "clubInvite": true,
    "territoryStolenSingle": true,
    "territoryStolenPrivateLobby": true,
    "referralCodeUsed": true,
    "marketingAnnouncements": true,
    "captureThreshold5OrLess": false,
    "captureThreshold5To20": false
  }'::jsonb;
