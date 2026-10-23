-- =====================================================================
-- Англи хэлний сургалтын төвийн ERP — Database ба хэрэглэгч үүсгэх
-- Сервер: XAMPP MariaDB 10.4.32, порт 3306
-- Ажиллуулах газар: phpMyAdmin → SQL таб (root эрхээр)
--
-- АНХААР: Энэ файлд жинхэнэ нууц үг БИЧИХГҮЙ.
-- phpMyAdmin-д буулгасны ДАРАА л CHANGE_ME_PASSWORD-ийг солино.
-- =====================================================================

-- 1. Үндсэн database
CREATE DATABASE IF NOT EXISTS english_center_erp
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 2. Prisma migration-ий shadow database (зөвхөн хөгжүүлэлтэд)
CREATE DATABASE IF NOT EXISTS english_center_erp_shadow
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 3. Төслийн хэрэглэгч (localhost болон 127.0.0.1 хоёуланд)
CREATE USER IF NOT EXISTS 'erp_user'@'localhost' IDENTIFIED BY 'CHANGE_ME_PASSWORD';
CREATE USER IF NOT EXISTS 'erp_user'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME_PASSWORD';

-- 4. Эрх: зөвхөн энэ хоёр database дээр
GRANT ALL PRIVILEGES ON english_center_erp.*        TO 'erp_user'@'localhost';
GRANT ALL PRIVILEGES ON english_center_erp_shadow.* TO 'erp_user'@'localhost';
GRANT ALL PRIVILEGES ON english_center_erp.*        TO 'erp_user'@'127.0.0.1';
GRANT ALL PRIVILEGES ON english_center_erp_shadow.* TO 'erp_user'@'127.0.0.1';

FLUSH PRIVILEGES;