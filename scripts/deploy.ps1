param([ValidatePattern('^[a-zA-Z0-9._-]+$')][string]$Repository = 'trade-notebook')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$env:GIT_TERMINAL_PROMPT = '0'

gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    $credentialLines = @('protocol=https', 'host=github.com', '') | git -c credential.interactive=never credential fill 2>$null
    if ($LASTEXITCODE -eq 0) {
        $credentialPassword = $credentialLines | Where-Object { $_.StartsWith('password=') } | Select-Object -First 1
        if ($credentialPassword) { $env:GH_TOKEN = $credentialPassword.Substring(9) }
    }
}
$account = gh api user --jq .login
if ($LASTEXITCODE -ne 0) { throw 'GitHub sign-in required. Run: gh auth login --web --scopes workflow' }
$remoteUrl = "https://github.com/$account/$Repository.git"
$origin = git remote get-url origin 2>$null
if ($origin -and $origin -ne $remoteUrl) { throw "This project already has a different origin: $origin" }
if (-not $origin) {
    $existing = gh api "repos/$account/$Repository" --jq .full_name 2>$null
    if ($LASTEXITCODE -eq 0) { throw "Repository $existing already exists. Choose a different -Repository name." }
    gh repo create "$account/$Repository" --public --description '交易纠错本：期货交易记录、盈亏统计与复盘分析'
    if ($LASTEXITCODE -ne 0) { throw 'GitHub repository creation failed.' }
    git remote add origin $remoteUrl
    if ($LASTEXITCODE -ne 0) { throw 'Unable to set the project remote.' }
}
$pages = gh api "repos/$account/$Repository/pages" --jq .build_type 2>$null
if ($LASTEXITCODE -ne 0) {
    gh api --method POST "repos/$account/$Repository/pages" -f build_type=workflow --silent
    if ($LASTEXITCODE -ne 0) { throw 'Unable to enable GitHub Pages.' }
} elseif ($pages -ne 'workflow') {
    gh api --method PUT "repos/$account/$Repository/pages" -f build_type=workflow --silent
    if ($LASTEXITCODE -ne 0) { throw 'Unable to configure GitHub Pages.' }
}
git push -u origin main
if ($LASTEXITCODE -ne 0) { throw 'Git push failed. Check GitHub access and workflow permission.' }
Write-Output "Repository: https://github.com/$account/$Repository"
Write-Output "Pages URL (after workflow succeeds): https://$account.github.io/$Repository/"
gh run list --repo "$account/$Repository" --limit 1 --json databaseId,status,conclusion,url
