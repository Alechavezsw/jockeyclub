@echo off
title Jockey Club San Juan - Lanzador ERP Local
chcp 65001 > nul
cls

echo ==========================================================
echo       JOCKEY CLUB SAN JUAN - SEDE RIVADAVIA
echo             Lanzador ERP Local Automático
echo ==========================================================
echo.

:: Verificar si Node.js está instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no está instalado en este sistema.
    echo Por favor, descargue e instale Node.js desde https://nodejs.org/
    echo e inténtelo nuevamente.
    echo.
    pause
    exit /b 1
)

:: Verificar si existe la carpeta node_modules
if not exist "node_modules\" (
    echo [INFO] No se detectó la carpeta 'node_modules'. 
    echo Instalando dependencias del sistema... Por favor, espere.
    echo.
    call npm.cmd install
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Ocurrió un error al instalar las dependencias con 'npm.cmd'.
        echo Intentando alternativamente con 'npm'...
        call npm install
    )
)

echo.
echo [INFO] Iniciando el servidor local del Jockey Club ERP...
echo [INFO] Su aplicación web se abrirá automáticamente.
echo.

:: Abrir el navegador por defecto
start http://localhost:5173

:: Iniciar el servidor de desarrollo
call npm.cmd run dev
if %errorlevel% neq 0 (
    call npm run dev
)

pause
