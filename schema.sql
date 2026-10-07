-- ============================================================================
--  Tablas nuevas: roles y permisos, chat con memoria, tareas repetidas / subtareas / prioridad,
--  presupuestos, lista de la compra compartida y preferencias (resumen de la mañana, calendario).
--
--  NO hace falta ejecutarlo normalmente: la app crea estas tablas sola la primera vez
--  (igual que hace con los grupos o los lugares del tiempo). Úsalo solo si el panel de
--  Administración muestra el aviso "Los roles aún no están disponibles" porque el usuario
--  de la base de datos no tiene permiso para crear tablas.
--
--  Cómo: aaPanel → Base de datos → (tu base) → phpMyAdmin → pestaña SQL → pega y ejecuta.
--  Es seguro ejecutarlo más de una vez, salvo la línea marcada con (*).
-- ============================================================================

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  description VARCHAR(200) NOT NULL DEFAULT '',
  modules TEXT NULL,                       -- JSON: {"tareas":"allow","chat":"hidden",...}  (allow | locked | hidden)
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_role_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_settings (
  k VARCHAR(60) NOT NULL PRIMARY KEY,      -- 'messages' = mensajes de permisos
  v MEDIUMTEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- (*) Si te da error "Duplicate column name 'role_id'", ya existe: ignóralo.
ALTER TABLE users ADD COLUMN role_id INT NULL;

-- Rol por defecto (solo si todavía no hay ninguno): todos los módulos menos el chat.
INSERT INTO roles (name, description, modules, is_default)
SELECT 'Usuario', 'Rol por defecto: todos los módulos salvo el chat.',
       '{"tareas":"allow","calendario":"allow","chat":"hidden","notas":"allow","diagramas":"allow","gastos":"allow","estadisticas":"allow","tiempo":"allow","grupo":"allow","asistente":"allow"}', 1
WHERE NOT EXISTS (SELECT 1 FROM roles);

-- Chat con memoria
CREATE TABLE IF NOT EXISTS chat_conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_chat_user (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  role VARCHAR(12) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_chat_conv (conversation_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_settings (
  user_id INT NOT NULL PRIMARY KEY,
  about TEXT NULL,                         -- "lo que quiero que sepas de mí"
  style TEXT NULL,                         -- "cómo quiero que respondas"
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- (*) Si te da error "Duplicate column name 'data_access'", ya existe: ignóralo.
ALTER TABLE chat_settings ADD COLUMN data_access TINYINT(1) NOT NULL DEFAULT 0;   -- permitir que el chat consulte los datos del usuario

-- Tareas: prioridad, repetición y subtareas
-- (*) Si alguna da "Duplicate column name", ya existe: ignóralo.
ALTER TABLE tasks ADD COLUMN priority TINYINT NOT NULL DEFAULT 0;      -- 0 normal · 1 baja · 2 media · 3 alta
ALTER TABLE tasks ADD COLUMN repeat_rule VARCHAR(16) NULL;             -- daily | weekdays | weekly | monthly | yearly
ALTER TABLE tasks ADD COLUMN checklist TEXT NULL;                      -- JSON: [{"t":"subtarea","d":false}]

-- Presupuestos mensuales (category_id 0 = presupuesto total)
CREATE TABLE IF NOT EXISTS budgets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  category_id INT NOT NULL DEFAULT 0,
  amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_budget (user_id, category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Lista de la compra (group_id NULL = personal; si no, compartida con ese grupo)
CREATE TABLE IF NOT EXISTS shopping_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  group_id INT NULL,
  name VARCHAR(120) NOT NULL,
  qty VARCHAR(30) NULL,
  done TINYINT(1) NOT NULL DEFAULT 0,
  done_by INT NULL,
  archived TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  done_at TIMESTAMP NULL DEFAULT NULL,
  KEY idx_shop_group (group_id, archived),
  KEY idx_shop_user (user_id, archived)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Preferencias por usuario: resumen de la mañana y enlace secreto del calendario
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id INT NOT NULL PRIMARY KEY,
  brief_enabled TINYINT(1) NOT NULL DEFAULT 0,
  brief_time CHAR(5) NOT NULL DEFAULT '08:00',
  tz VARCHAR(64) NOT NULL DEFAULT 'Europe/Madrid',
  last_brief DATE NULL,
  calendar_token CHAR(40) NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cal_token (calendar_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Límite diario de mensajes de IA por usuario
CREATE TABLE IF NOT EXISTS assistant_usage (
  user_id INT NOT NULL,
  day DATE NOT NULL,
  n INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
