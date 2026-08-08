function Test-MonCahierDevelopmentCheckout([string]$RelayRoot) {
    $Candidates = @(
        (Join-Path $RelayRoot ".git"),
        (Join-Path $RelayRoot "..\.git"),
        (Join-Path $RelayRoot "..\..\.git")
    )
    return @($Candidates | Where-Object { Test-Path $_ }).Count -gt 0
}

function Assert-MonCahierRelayReleasePackage(
    [string]$RelayRoot,
    [string]$NodeExecutable
) {
    $ManifestPath = Join-Path $RelayRoot "release-manifest.json"
    $SafetyScript = Join-Path $RelayRoot "scripts\assert-release-safe.mjs"

    if (-not (Test-Path $ManifestPath)) {
        if (Test-MonCahierDevelopmentCheckout $RelayRoot) {
            Write-Host "Dépôt de développement détecté : contrôle du manifeste de distribution ignoré."
            return
        }
        throw (
            "Paquet relais non fiable : release-manifest.json est absent. " +
            "Utilisez uniquement un ZIP créé par windows\New-Relay-Package.ps1."
        )
    }
    if (-not (Test-Path $SafetyScript)) {
        throw "Paquet relais incomplet : le vérificateur de sécurité est absent."
    }

    & $NodeExecutable $SafetyScript --root $RelayRoot --manifest $ManifestPath
    if ($LASTEXITCODE -ne 0) {
        throw (
            "Le paquet relais a été modifié, est incomplet ou contient un fichier interdit. " +
            "Téléchargez ou recréez un paquet propre."
        )
    }
}
