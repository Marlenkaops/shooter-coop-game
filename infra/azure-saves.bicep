targetScope = 'resourceGroup'

@description('Globally unique name for the approved usage-priced Table Storage account.')
@minLength(3)
@maxLength(24)
param accountName string = 'dlsaves${uniqueString(resourceGroup().id)}'

@description('Entra user object ID temporarily allowed to import and verify the migration.')
@minLength(36)
@maxLength(36)
param migrationPrincipalId string

@description('Temporary migration IPv4 address. Creates only a /32 rule; remove the rule after migration.')
@maxLength(15)
param migrationIpv4Address string = ''

var tableName = 'state'

resource runtimeIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'last-light-identity'
}

resource account 'Microsoft.Storage/storageAccounts@2025-06-01' = {
  name: accountName
  location: 'swedencentral'
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  tags: {
    application: 'Deadlight Ops'
    purpose: 'durable-game-saves'
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    allowCrossTenantReplication: false
    publicNetworkAccess: 'SecuredByPerimeter'
    networkAcls: {
      bypass: 'None'
      defaultAction: 'Allow'
    }
    encryption: {
      keySource: 'Microsoft.Storage'
      services: {
        table: {
          enabled: true
          // Service-scoped Microsoft keys retain the approved Standard LRS rates.
          keyType: 'Service'
        }
      }
    }
  }
}

resource perimeter 'Microsoft.Network/networkSecurityPerimeters@2025-01-01' = {
  name: 'deadlight-saves'
  location: 'swedencentral'
  tags: {
    application: 'Deadlight Ops'
    purpose: 'durable-game-saves'
  }
  properties: {}
}

resource gameProfile 'Microsoft.Network/networkSecurityPerimeters/profiles@2025-01-01' = {
  parent: perimeter
  name: 'game'
  properties: {}
}

resource gameSubscription 'Microsoft.Network/networkSecurityPerimeters/profiles/accessRules@2025-01-01' = {
  parent: gameProfile
  name: 'game-subscription'
  properties: {
    direction: 'Inbound'
    subscriptions: [
      {
        id: subscription().id
      }
    ]
  }
}

resource migrationConnection 'Microsoft.Network/networkSecurityPerimeters/profiles/accessRules@2025-01-01' = if (!empty(migrationIpv4Address)) {
  parent: gameProfile
  name: 'temporary-migration'
  properties: {
    direction: 'Inbound'
    addressPrefixes: [
      '${migrationIpv4Address}/32'
    ]
  }
}

resource association 'Microsoft.Network/networkSecurityPerimeters/resourceAssociations@2025-01-01' = {
  parent: perimeter
  name: 'saves'
  properties: {
    accessMode: 'Enforced'
    privateLinkResource: {
      id: account.id
    }
    profile: {
      id: gameProfile.id
    }
  }
  dependsOn: [
    gameSubscription
  ]
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    cors: {
      corsRules: []
    }
  }
}

resource state 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: tableName
}

var dataRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')

resource runtimeAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: state
  name: guid(state.id, runtimeIdentity.id, 'saves-runtime')
  properties: {
    roleDefinitionId: dataRoleDefinitionId
    principalId: runtimeIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource migrationAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: state
  name: guid(state.id, migrationPrincipalId, 'saves-import')
  properties: {
    roleDefinitionId: dataRoleDefinitionId
    principalId: migrationPrincipalId
    principalType: 'User'
  }
}

output endpoint string = account.properties.primaryEndpoints.table
output accountId string = account.id
output table string = tableName
output partition string = 'game'
output runtimeClientId string = runtimeIdentity.properties.clientId
output migrationRoleAssignmentId string = migrationAccess.id
output perimeterId string = perimeter.id
