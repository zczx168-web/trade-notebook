$ErrorActionPreference = 'Stop'
$repo = 'zczx168-web/trade-notebook'
$rules = gh api "repos/$repo/rulesets" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect existing repository rules.' }
if (-not ($rules | Where-Object { $_.name -eq 'Protect published main' })) {
    $body = @{
        name = 'Protect published main'
        target = 'branch'
        enforcement = 'active'
        conditions = @{ ref_name = @{ include = @('refs/heads/main'); exclude = @() } }
        rules = @(@{ type = 'deletion' }, @{ type = 'non_fast_forward' })
    } | ConvertTo-Json -Depth 10
    $body | gh api "repos/$repo/rulesets" --method POST --input - --jq '{id,name,enforcement}'
    if ($LASTEXITCODE -ne 0) { throw 'Unable to enable branch protections.' }
}
gh api "repos/$repo/vulnerability-alerts" --method PUT
if ($LASTEXITCODE -ne 0) { throw 'Unable to enable dependency alerts.' }
gh api "repos/$repo/automated-security-fixes" --method PUT
if ($LASTEXITCODE -ne 0) { throw 'Unable to enable dependency security fixes.' }
Write-Output 'Main branch deletion and force pushes protected; dependency security alerts and fixes enabled.'
