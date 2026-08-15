# create-homolog-db.ps1
#
# Cria o banco de homologação (separado do banco de dev) na instância local
# de PostgreSQL 18 + PostGIS e habilita a extensão PostGIS nele.
#
# Uso:
#   .\create-homolog-db.ps1
#   .\create-homolog-db.ps1 -DbName sevenclub_homolog -PgUser postgres

param(
  [string]$PgUser = "postgres",
  [string]$PgHostName = "localhost",
  [string]$PgPort = "5432",
  [string]$DbName = "sevenclub_homolog"
)

$SecurePassword = Read-Host "Senha do usuario '$PgUser' no PostgreSQL local" -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
$env:PGPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

Write-Host "`nCriando banco '$DbName'..." -ForegroundColor Cyan
psql -U $PgUser -h $PgHostName -p $PgPort -c "CREATE DATABASE $DbName;"

if ($LASTEXITCODE -ne 0) {
  Write-Host "`nNao foi possivel criar o banco. Se ele ja existir, pode ignorar este erro e seguir em frente." -ForegroundColor Yellow
}

Write-Host "`nHabilitando extensoes em '$DbName'..." -ForegroundColor Cyan
psql -U $PgUser -h $PgHostName -p $PgPort -d $DbName -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto;"

Write-Host "`nPronto. Banco '$DbName' criado e com PostGIS habilitado." -ForegroundColor Green
Write-Host "Proximo passo: configure .env.homolog com a DATABASE_URL e rode 'npm run migrate:homolog'." -ForegroundColor Green

Remove-Item Env:\PGPASSWORD
