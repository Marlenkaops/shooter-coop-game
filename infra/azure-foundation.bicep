param location string = 'swedencentral'
param prefix string = 'last-light'
param registryName string = 'lastlight${uniqueString(resourceGroup().id)}'

var tags = {
  application: 'last-light'
}
var acrPullRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-identity'
  location: location
  tags: tags
}

resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, acrPullRole)
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRole
  }
}

resource expressEnvironment 'Microsoft.App/managedEnvironments@2026-03-02-preview' = {
  name: '${prefix}-env'
  location: location
  tags: tags
  properties: {
    environmentMode: 'Express'
    publicNetworkAccess: 'Enabled'
  }
}

output environmentId string = expressEnvironment.id
output identityId string = identity.id
output registryName string = registry.name
output registryServer string = registry.properties.loginServer
