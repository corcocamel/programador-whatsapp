@echo off
title Servidor de Mensajes WhatsApp
echo ========================================================
echo   Iniciando Servidor Programador de Mensajes WhatsApp
echo ========================================================
echo.
echo Abriendo aplicacion en tu navegador...
start http://localhost:3000
echo.
echo Iniciando servidor Node.js...
node server.js
pause
