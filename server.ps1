param([switch]$NoLaunch)

$port = 8090
$root = $PSScriptRoot
$url  = "http://localhost:$port/"

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($url)
$listener.Start()

Write-Host ""
Write-Host "  ================================"
Write-Host "    GREMLIN - Noise Floor Analyzer"
Write-Host "  ================================"
Write-Host ""
Write-Host "  Running at: http://localhost:$port/app/"
Write-Host "  Close this window to stop."
Write-Host ""

if (-not $NoLaunch) { Start-Process "http://localhost:$port/app/" }

# ── plink finder (shared helper) ──────────────────────────────
function Find-Plink {
    $p = Get-Command 'plink.exe' -ErrorAction SilentlyContinue |
         Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue
    if ($p) { return $p }
    foreach ($dir in @(
        "$env:ProgramFiles\PuTTY", "${env:ProgramFiles(x86)}\PuTTY",
        "$env:LOCALAPPDATA\Programs\PuTTY", "C:\PuTTY", "C:\tools",
        "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Downloads"
    )) {
        $loc = Join-Path $dir 'plink.exe'
        if (Test-Path $loc) { return $loc }
    }
    $putty = Get-Command 'putty.exe' -ErrorAction SilentlyContinue |
             Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue
    if ($putty) {
        $loc = Join-Path ([IO.Path]::GetDirectoryName($putty)) 'plink.exe'
        if (Test-Path $loc) { return $loc }
    }
    return $null
}

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
        $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')

        # ── POST /enm/nfmos — SSH into AMOS, run NF.mos, capture output ──────
        if ($path -eq 'enm/nfmos' -and $req.HttpMethod -eq 'POST') {
            $res.ContentType = 'application/json'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            try {
                $body    = (New-Object IO.StreamReader $req.InputStream).ReadToEnd()
                $payload = $body | ConvertFrom-Json
                $sshHost = if ($payload.host) { $payload.host } else { '10.255.160.2' }
                $sshUser = if ($payload.user) { $payload.user } else { 'aatia' }
                $sshPass = $payload.pass
                $site    = $payload.site

                $plink = Find-Plink
                if (-not $plink) {
                    $errJson  = '{"error":"plink.exe not found. Copy plink.exe to C:\\tools\\plink.exe and restart the server."}'
                    $errBytes = [Text.Encoding]::UTF8.GetBytes($errJson)
                    $res.StatusCode = 500; $res.ContentLength64 = $errBytes.Length
                    $res.OutputStream.Write($errBytes, 0, $errBytes.Length)
                    $res.OutputStream.Close(); continue
                }

                # NF.mos runs lt all itself.
                # After NF.mos, run pmr → choose report 206 → x to exit pmr menu.
                # Unix LF only — PTY icrnl translates \r to \n, making \r\n become double-\n
                $amosCmds = "amos $site`nrun NF.mos`nst cell`nget . earfcn`nget . bandwidth`nget . crsgain`nue print -admitted`npmr`n206`nx`nq`nexit`n"

                $rand    = [IO.Path]::GetRandomFileName() -replace '\.[^.]+$',''
                $tmpDir  = [IO.Path]::GetTempPath()
                $tmpCmds = Join-Path $tmpDir "gremlin_cmds_$rand.txt"
                $tmpOut  = Join-Path $tmpDir "gremlin_out_$rand.txt"
                $tmpDone = Join-Path $tmpDir "gremlin_done_$rand.txt"
                $tmpBat  = Join-Path $tmpDir "gremlin_$rand.bat"

                [IO.File]::WriteAllText($tmpCmds, $amosCmds, [Text.Encoding]::ASCII)

                # Bat: shows "Connecting..." while plink runs silently into a file,
                # then clears and dumps the full output so engineer can read it.
                $bat  = "@echo off`r`n"
                $bat += "title GREMLIN - $site`r`n"
                $bat += "color 07`r`n"
                $bat += "echo ====================================`r`n"
                $bat += "echo  GREMLIN - Noise Floor Analysis`r`n"
                $bat += "echo  Site: $site`r`n"
                $bat += "echo ====================================`r`n"
                $bat += "echo.`r`n"
                $bat += "echo  Connecting to AMOS... please wait`r`n"
                $bat += "echo.`r`n"
                $bat += "`"$plink`" -ssh -t -batch -pw `"$sshPass`" -l `"$sshUser`" `"$sshHost`" < `"$tmpCmds`" > `"$tmpOut`" 2>&1`r`n"
                $bat += "echo 1 > `"$tmpDone`"`r`n"
                $bat += "cls`r`n"
                $bat += "type `"$tmpOut`"`r`n"
                $bat += "echo.`r`n"
                $bat += "echo ====================================`r`n"
                $bat += "echo  Done - press any key to close`r`n"
                $bat += "echo ====================================`r`n"
                $bat += "pause >nul`r`n"
                $bat += "del `"$tmpCmds`" 2>nul`r`n"
                $bat += "del `"$tmpOut`" 2>nul`r`n"
                $bat += "del `"$tmpDone`" 2>nul`r`n"
                $bat += "del `"%~f0`" 2>nul`r`n"
                [IO.File]::WriteAllText($tmpBat, $bat, [Text.Encoding]::ASCII)

                # Launch visible CMD window
                $cmdArgs = '/C ""{0}""' -f $tmpBat
                Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArgs -WindowStyle Normal

                # Poll for done sentinel (written by bat after plink exits)
                $deadline = [DateTime]::Now.AddSeconds(180)
                while ([DateTime]::Now -lt $deadline) {
                    if (Test-Path $tmpDone) { Start-Sleep -Milliseconds 300; break }
                    Start-Sleep -Milliseconds 500
                }

                # Read captured output (bat still needs file for `type`, so don't delete it here)
                $stdout = ''
                if (Test-Path $tmpOut) {
                    try { $stdout = [IO.File]::ReadAllText($tmpOut, [Text.Encoding]::UTF8) } catch {}
                }
                try { [IO.File]::Delete($tmpDone) } catch {}
                try { [IO.File]::Delete($tmpCmds) } catch {}

                $okObj  = [PSCustomObject]@{ ok = $true; site = $site; output = $stdout }
                $okJson = $okObj | ConvertTo-Json -Compress -Depth 3
                $okBytes = [Text.Encoding]::UTF8.GetBytes($okJson)
                $res.StatusCode = 200; $res.ContentLength64 = $okBytes.Length
                $res.OutputStream.Write($okBytes, 0, $okBytes.Length)
            } catch {
                $errJson  = '{"error":"' + ($_.Exception.Message -replace '"','\"') + '"}'
                $errBytes = [Text.Encoding]::UTF8.GetBytes($errJson)
                $res.StatusCode = 500; $res.ContentLength64 = $errBytes.Length
                $res.OutputStream.Write($errBytes, 0, $errBytes.Length)
            }
            try { $res.OutputStream.Close() } catch {}
            continue
        }
        # ─────────────────────────────────────────────────────────────────────

        # ── POST /enm/amos — launch interactive AMOS terminal in CMD window ──
        if ($path -eq 'enm/amos' -and $req.HttpMethod -eq 'POST') {
            $res.ContentType = 'application/json'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            try {
                $body    = (New-Object IO.StreamReader $req.InputStream).ReadToEnd()
                $payload = $body | ConvertFrom-Json
                $sshHost = if ($payload.host) { $payload.host } else { '10.255.160.2' }
                $sshUser = if ($payload.user) { $payload.user } else { 'zira' }
                $sshPass = $payload.pass
                $site    = $payload.site

                $plink = Find-Plink
                if (-not $plink) {
                    $errJson  = '{"ok":false,"error":"plink.exe not found."}'
                    $errBytes = [Text.Encoding]::UTF8.GetBytes($errJson)
                    $res.StatusCode = 500; $res.ContentLength64 = $errBytes.Length
                    $res.OutputStream.Write($errBytes, 0, $errBytes.Length)
                    $res.OutputStream.Close(); continue
                }

                # BAT file: no -batch, no stdin redirect — fully interactive PTY
                $rand   = [IO.Path]::GetRandomFileName() -replace '\.[^.]+$',''
                $tmpBat = Join-Path ([IO.Path]::GetTempPath()) "gremlin_amos_$rand.bat"
                $bat    = "@echo off`r`n"
                $bat   += "title GREMLIN AMOS -- $site`r`n"
                $bat   += "color 07`r`n"
                $bat   += "`"$plink`" -ssh -t -pw `"$sshPass`" -l `"$sshUser`" `"$sshHost`" `"amos $site`"`r`n"
                $bat   += "del `"%~f0`" 2>nul`r`n"
                [IO.File]::WriteAllText($tmpBat, $bat, [Text.Encoding]::ASCII)

                $cmdArgs = '/C ""{0}""' -f $tmpBat
                Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArgs -WindowStyle Normal

                $okBytes = [Text.Encoding]::UTF8.GetBytes('{"ok":true}')
                $res.StatusCode = 200; $res.ContentLength64 = $okBytes.Length
                $res.OutputStream.Write($okBytes, 0, $okBytes.Length)
            } catch {
                $errJson  = '{"ok":false,"error":"' + ($_.Exception.Message -replace '"','\"') + '"}'
                $errBytes = [Text.Encoding]::UTF8.GetBytes($errJson)
                $res.StatusCode = 500; $res.ContentLength64 = $errBytes.Length
                $res.OutputStream.Write($errBytes, 0, $errBytes.Length)
            }
            try { $res.OutputStream.Close() } catch {}
            continue
        }
        # ─────────────────────────────────────────────────────────────────────

        # ── POST /enm/macro — site-check commands: one hidden plink session per site ──
        # Returns {ok, site, output}. Always hidden — no visible CMD window.
        if ($path -eq 'enm/macro' -and $req.HttpMethod -eq 'POST') {
            $res.ContentType = 'application/json'
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            try {
                $body    = (New-Object IO.StreamReader $req.InputStream).ReadToEnd()
                $payload = $body | ConvertFrom-Json
                $sshHost = if ($payload.host) { $payload.host } else { '10.255.160.2' }
                $sshUser = if ($payload.user) { $payload.user } else { 'zira' }
                $sshPass = $payload.pass
                $site    = $payload.site
                $cmds    = @($payload.cmds)

                $plink = Find-Plink
                if (-not $plink) {
                    $errJson  = '{"ok":false,"error":"plink.exe not found."}'
                    $errBytes = [Text.Encoding]::UTF8.GetBytes($errJson)
                    $res.StatusCode = 500; $res.ContentLength64 = $errBytes.Length
                    $res.OutputStream.Write($errBytes, 0, $errBytes.Length)
                    $res.OutputStream.Close(); continue
                }

                # Build AMOS command sequence — Unix LF only (PTY icrnl)
                $lines    = @("amos $site") + $cmds + @("q", "exit")
                $amosCmds = ($lines -join "`n") + "`n"

                $rand    = [IO.Path]::GetRandomFileName() -replace '\.[^.]+$',''
                $tmpDir  = [IO.Path]::GetTempPath()
                $tmpCmds = Join-Path $tmpDir "gremlin_mc_$rand.txt"
                $tmpOut  = Join-Path $tmpDir "gremlin_mo_$rand.txt"
                $tmpDone = Join-Path $tmpDir "gremlin_md_$rand.txt"
                $tmpBat  = Join-Path $tmpDir "gremlin_mb_$rand.bat"

                [IO.File]::WriteAllText($tmpCmds, $amosCmds, [Text.Encoding]::ASCII)

                # Always hidden — output returned via JSON
                $bat  = "@echo off`r`n"
                $bat += "`"$plink`" -ssh -t -batch -pw `"$sshPass`" -l `"$sshUser`" `"$sshHost`" < `"$tmpCmds`" > `"$tmpOut`" 2>&1`r`n"
                $bat += "echo 1 > `"$tmpDone`"`r`n"
                $bat += "del `"$tmpCmds`" 2>nul`r`n"
                $bat += "del `"%~f0`" 2>nul`r`n"
                [IO.File]::WriteAllText($tmpBat, $bat, [Text.Encoding]::ASCII)

                $cmdArgs = '/C ""{0}""' -f $tmpBat
                Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArgs -WindowStyle Hidden

                # Poll for done sentinel (120s timeout)
                $deadline = [DateTime]::Now.AddSeconds(120)
                while ([DateTime]::Now -lt $deadline) {
                    if (Test-Path $tmpDone) { Start-Sleep -Milliseconds 300; break }
                    Start-Sleep -Milliseconds 500
                }

                $stdout = ''
                if (Test-Path $tmpOut) {
                    try { $stdout = [IO.File]::ReadAllText($tmpOut, [Text.Encoding]::UTF8) } catch {}
                }
                try { [IO.File]::Delete($tmpDone) } catch {}
                try { [IO.File]::Delete($tmpOut)  } catch {}

                $okObj   = [PSCustomObject]@{ ok = $true; site = $site; output = $stdout }
                $okJson  = $okObj | ConvertTo-Json -Compress -Depth 3
                $okBytes = [Text.Encoding]::UTF8.GetBytes($okJson)
                $res.StatusCode = 200; $res.ContentLength64 = $okBytes.Length
                $res.OutputStream.Write($okBytes, 0, $okBytes.Length)
            } catch {
                $errJson  = '{"ok":false,"error":"' + ($_.Exception.Message -replace '"','\"') + '"}'
                $errBytes = [Text.Encoding]::UTF8.GetBytes($errJson)
                $res.StatusCode = 500; $res.ContentLength64 = $errBytes.Length
                $res.OutputStream.Write($errBytes, 0, $errBytes.Length)
            }
            try { $res.OutputStream.Close() } catch {}
            continue
        }
        # ─────────────────────────────────────────────────────────────────────

        # ── Static file server ────────────────────────────────────────────────
        $file = Join-Path $root ($path.Replace('/', [IO.Path]::DirectorySeparatorChar))
        if ([IO.Directory]::Exists($file)) { $file = Join-Path $file 'index.html' }

        if ([IO.File]::Exists($file)) {
            $mime = switch ([IO.Path]::GetExtension($file).ToLower()) {
                '.html' { 'text/html; charset=utf-8' }
                '.js'   { 'application/javascript' }
                '.css'  { 'text/css' }
                '.woff2'{ 'font/woff2' }
                '.svg'  { 'image/svg+xml' }
                default { 'application/octet-stream' }
            }
            $bytes = [IO.File]::ReadAllBytes($file)
            $res.ContentType = $mime
            $res.StatusCode  = 200
            $res.Headers.Add('Access-Control-Allow-Origin', '*')
            if ($mime -match 'javascript|css') {
                $res.Headers.Add('Cache-Control', 'no-store')
            }
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
        }
    } catch { $res.StatusCode = 500 }
    try { $res.OutputStream.Close() } catch {}
}
