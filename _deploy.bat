@echo off
cd /d "G:\My Drive\Sidie Golf\Netlify-Deploy"
set /p COMMIT_MSG=<_commit_msg.txt
echo Committing: %COMMIT_MSG%
git add -A
git commit -m "%COMMIT_MSG%"
git push
echo.
echo ✓ Pushed to GitHub — Vercel is deploying now.
timeout /t 6
