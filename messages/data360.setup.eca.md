# summary

Create an External Client Application (ECA) for Data 360 Direct API access.

# description

Provisions an External Client Application on the target org with the OAuth scopes required by Data 360 Direct Query, Profile, and Ingestion APIs.

The command creates the ECA via the Metadata SOAP API, configures its OAuth settings with the required `cdp_*` scopes, and retrieves the resulting consumer key. After the ECA is active, reauthorize the org with the consumer key and scopes to enable Direct API access.

The Metadata API approach is the Salesforce-endorsed mechanism for programmatic ECA creation and is documented on Trailhead.

# examples

- Create an ECA on the default target org:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Create an ECA with a custom app name:
  <%= config.bin %> <%= command.id %> --target-org my-org --app-name MyDataCloudCLI
- Create without interactive confirmation:
  <%= config.bin %> <%= command.id %> --target-org my-org --no-prompt --json

# flags.app-name.summary

Developer name for the External Client Application (alphanumeric and underscores only; maximum 30 characters).

# flags.contact-email.summary

Contact email registered with the External Client Application (defaults to the authenticated username).

# info.ECA_CREATING

Creating External Client Application "%s" on the target org.

# info.ECA_STEP_APP

Creating ExternalClientApplication metadata.

# info.ECA_STEP_OAUTH

Configuring ExtlClntAppOauthSettings with Data 360 scopes.

# info.ECA_STEP_GLOBAL

Configuring ExtlClntAppGlobalOauthSettings (OAuth flows and callbacks).

# info.ECA_STEP_RETRIEVE

Retrieving consumer key from org metadata.

# info.ECA_CREATED

External Client Application "%s" created.

# info.ECA_REAUTH_INSTRUCTIONS

Reauthorize the org with the consumer key and Data 360 scopes:

sf org login web \
--instance-url %s \
--client-id %s \
--alias %s \
--scopes %s

Then verify Direct API access:

sf data360 doctor --target-org %s

# info.ECA_DUPLICATE

The application "%s" already exists. Proceeding to retrieve the consumer key.

# info.ECA_GLOBAL_WARN

Global OAuth settings creation returned: %s

# info.ECA_ACTIVATION_NOTE

Note: Newly created ECAs may take up to 30 minutes to become fully operational.

# error.D360_ECA_CREATE_FAILED

Failed to create External Client Application via Metadata API.

# error.D360_ECA_CREATE_FAILED.actions

Verify admin permissions on the target org and that External Client Apps are enabled.

# error.D360_ECA_CONTACT_REQUIRED

A contact email is required to create the External Client Application.

# error.D360_ECA_CONTACT_REQUIRED.actions

Pass --contact-email when the authenticated org username is unavailable.

# error.D360_ECA_OAUTH_FAILED

Failed to configure OAuth settings on the External Client Application.

# error.D360_ECA_OAUTH_FAILED.actions

Check that the ECA was created successfully and that the org supports the requested OAuth scopes.

# error.D360_ECA_RETRIEVE_FAILED

Could not retrieve the consumer key from the created External Client Application.

# error.D360_ECA_RETRIEVE_FAILED.actions

Verify the ECA exists in Setup > External Client App Manager. The consumer key may require manual retrieval from the Setup UI.

# error.D360_ECA_INVALID_NAME

The app name "%s" is invalid. Use only alphanumeric characters and underscores, starting with a letter.

# error.D360_ECA_INVALID_NAME.actions

Provide a valid Salesforce developer name (e.g., "D360CLI" or "My_Data_Cloud_App").
