import { expect } from 'chai';
import { Connection } from '@salesforce/core';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import SetupEca from '../src/commands/data360/setup/eca.js';
import { createCommandTestContext } from './helpers/command.js';

describe('setup commands', () => {
  const commandTest = createCommandTestContext();

  afterEach((): void => {
    process.exitCode = undefined;
  });

  it('creates ECA through real parsing', async () => {
    const org = new MockTestOrgData('setup-eca-org');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'retrieveMaxApiVersion').resolves('67.0');

    const fetchStub = commandTest.context.SANDBOX.stub(globalThis, 'fetch');

    // Step 1: createMetadata for ExternalClientApplication — success
    fetchStub
      .onFirstCall()
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><createMetadataResponse><result><success>true</success><fullName>D360CLI</fullName></result></createMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );

    // Step 2: createMetadata for ExtlClntAppOauthSettings — success
    fetchStub
      .onSecondCall()
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><createMetadataResponse><result><success>true</success><fullName>D360CLI_oauth</fullName></result></createMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );

    // Step 3: createMetadata for ExtlClntAppGlobalOauthSettings — success
    fetchStub
      .onThirdCall()
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><createMetadataResponse><result><success>true</success><fullName>D360CLI_glbloauth</fullName></result></createMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );

    // Step 4: readMetadata for consumer key retrieval
    fetchStub
      .onCall(3)
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><readMetadataResponse><result><records><fullName>D360CLI_glbloauth</fullName><consumerKey>3MVG9_TEST_CONSUMER_KEY</consumerKey></records></result></readMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );

    const result = await SetupEca.run(['--target-org', org.username, '--no-prompt', '--json']);

    expect(result.appName).to.equal('D360CLI');
    expect(result.consumerKey).to.equal('3MVG9_TEST_CONSUMER_KEY');
    expect(result.created).to.equal(true);
    expect(result.scopes).to.include('cdp_api');
    expect(result.scopes).to.include('cdp_query_api');
    expect(result.scopes).to.include('cdp_profile_api');
    expect(result.scopes).to.include('cdp_ingest_api');
    expect(result.reauthorizeCommand).to.include('sf org login web');
    expect(result.reauthorizeCommand).to.include("--client-id '3MVG9_TEST_CONSUMER_KEY'");
    expect(result.reauthorizeCommand).to.include(`--alias '${org.username}'`);

    // Verify all four SOAP calls were made
    expect(fetchStub.callCount).to.equal(4);

    // Verify createMetadata calls used correct SOAPAction header
    for (let i = 0; i < 3; i++) {
      const call = fetchStub.getCall(i);
      expect(call.args[1]?.headers).to.have.property('SOAPAction', 'createMetadata');
    }

    // Verify readMetadata call
    const readCall = fetchStub.getCall(3);
    expect(readCall.args[1]?.headers).to.have.property('SOAPAction', 'readMetadata');

    const oauthBody = fetchStub.getCall(1).args[1]?.body as string;
    expect(oauthBody).to.include('Api, Web, RefreshToken, CDP, CDPQuery, CDPProfile, CDPIngest');
    const globalBody = fetchStub.getCall(2).args[1]?.body as string;
    expect(globalBody)
      .to.include('<met:isClientCredentialsFlowEnabled>false</met:isClientCredentialsFlowEnabled>')
      .and.include('<met:isPkceRequired>true</met:isPkceRequired>');
  });

  it('does not let JSON output bypass destructive confirmation', async () => {
    const org = new MockTestOrgData('setup-eca-confirm');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'retrieveMaxApiVersion').resolves('67.0');
    const fetchStub = commandTest.context.SANDBOX.stub(globalThis, 'fetch');

    let error: unknown;
    try {
      await SetupEca.run(['--target-org', org.username, '--json']);
    } catch (caught) {
      error = caught;
    }

    expect((error as Error & { code?: string }).code).to.equal('D360_CONFIRMATION_REQUIRED');
    expect(fetchStub.callCount).to.equal(0);
  });

  it('handles duplicate app gracefully and still retrieves consumer key', async () => {
    const org = new MockTestOrgData('setup-eca-duplicate');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'retrieveMaxApiVersion').resolves('67.0');

    const fetchStub = commandTest.context.SANDBOX.stub(globalThis, 'fetch');

    // Step 1: createMetadata — DUPLICATE_VALUE
    fetchStub
      .onFirstCall()
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><createMetadataResponse><result><success>false</success><errors><message>duplicate value found</message><statusCode>DUPLICATE_VALUE</statusCode></errors></result></createMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );

    // Step 2: OAuth settings — duplicate too (expected on re-run)
    fetchStub
      .onSecondCall()
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><createMetadataResponse><result><success>false</success><errors><message>duplicate value found</message><statusCode>DUPLICATE_VALUE</statusCode></errors></result></createMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );

    // Step 3: Global settings — duplicate
    fetchStub
      .onThirdCall()
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><createMetadataResponse><result><success>false</success><errors><message>duplicate value found</message><statusCode>DUPLICATE_VALUE</statusCode></errors></result></createMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );

    // Step 4: readMetadata — retrieves the existing consumer key
    fetchStub
      .onCall(3)
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><readMetadataResponse><result><records><fullName>D360CLI_glbloauth</fullName><consumerKey>3MVG9_EXISTING_KEY</consumerKey></records></result></readMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );

    const result = await SetupEca.run(['--target-org', org.username, '--no-prompt', '--json']);

    expect(result.appName).to.equal('D360CLI');
    expect(result.consumerKey).to.equal('3MVG9_EXISTING_KEY');
    expect(result.created).to.equal(false);
  });

  it('rejects invalid app names through the real parser', async () => {
    const org = new MockTestOrgData('setup-eca-invalid');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'retrieveMaxApiVersion').resolves('67.0');

    try {
      await SetupEca.run(['--target-org', org.username, '--app-name', '123bad', '--no-prompt', '--json']);
      expect.fail('Should have thrown');
    } catch (error: unknown) {
      const err = error as Error & { code?: string };
      expect(err.code ?? err.name).to.equal('D360_ECA_INVALID_NAME');
    }
  });

  it('reserves suffix space in the Metadata API developer name limit', async () => {
    const org = new MockTestOrgData('setup-eca-name-limit');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'retrieveMaxApiVersion').resolves('67.0');

    let error: unknown;
    try {
      await SetupEca.run(['--target-org', org.username, '--app-name', `A${'b'.repeat(30)}`, '--no-prompt', '--json']);
    } catch (caught) {
      error = caught;
    }
    expect((error as Error & { code?: string }).code).to.equal('D360_ECA_INVALID_NAME');
  });

  it('throws D360_ECA_CREATE_FAILED on non-duplicate metadata API errors', async () => {
    const org = new MockTestOrgData('setup-eca-fail');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'retrieveMaxApiVersion').resolves('67.0');

    const fetchStub = commandTest.context.SANDBOX.stub(globalThis, 'fetch');
    fetchStub
      .onFirstCall()
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><createMetadataResponse><result><success>false</success><errors><message>Insufficient privileges</message><statusCode>INSUFFICIENT_ACCESS</statusCode></errors></result></createMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );

    try {
      await SetupEca.run(['--target-org', org.username, '--no-prompt', '--json']);
      expect.fail('Should have thrown');
    } catch (error: unknown) {
      const err = error as Error & { code?: string };
      expect(err.code ?? err.name).to.equal('D360_ECA_CREATE_FAILED');
    }
  });

  it('throws D360_ECA_OAUTH_FAILED when OAuth metadata is rejected', async () => {
    const org = new MockTestOrgData('setup-eca-oauth-fail');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'retrieveMaxApiVersion').resolves('67.0');

    const fetchStub = commandTest.context.SANDBOX.stub(globalThis, 'fetch');
    fetchStub
      .onFirstCall()
      .resolves(
        new Response(
          '<createMetadataResponse><result><success>true</success><fullName>D360CLI</fullName></result></createMetadataResponse>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );
    fetchStub
      .onSecondCall()
      .resolves(
        new Response(
          '<createMetadataResponse><result><success>false</success><errors><message>Scope rejected</message><statusCode>INVALID_FIELD</statusCode></errors></result></createMetadataResponse>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );

    let error: unknown;
    try {
      await SetupEca.run(['--target-org', org.username, '--no-prompt', '--json']);
    } catch (caught) {
      error = caught;
    }
    expect((error as Error & { code?: string }).code).to.equal('D360_ECA_OAUTH_FAILED');
  });

  it('normalizes HTTP and SOAP faults without exposing response bodies', async () => {
    const org = new MockTestOrgData('setup-eca-soap-fault');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'retrieveMaxApiVersion').resolves('67.0');
    commandTest.context.SANDBOX.stub(globalThis, 'fetch').resolves(
      new Response(
        '<soapenv:Envelope><soapenv:Body><soapenv:Fault><faultstring>Session rejected</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>',
        { status: 500, headers: { 'content-type': 'text/xml' } }
      )
    );

    let error: unknown;
    try {
      await SetupEca.run(['--target-org', org.username, '--no-prompt', '--json']);
    } catch (caught) {
      error = caught;
    }
    expect((error as Error & { code?: string }).code).to.equal('D360_ECA_CREATE_FAILED');
    expect((error as Error).message).to.not.include('Session rejected');
  });

  it('normalizes Metadata API network failures', async () => {
    const org = new MockTestOrgData('setup-eca-network-fault');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'retrieveMaxApiVersion').resolves('67.0');
    commandTest.context.SANDBOX.stub(globalThis, 'fetch').rejects(new Error('credentialed proxy details'));

    let error: unknown;
    try {
      await SetupEca.run(['--target-org', org.username, '--no-prompt', '--json']);
    } catch (caught) {
      error = caught;
    }
    expect((error as Error & { code?: string }).code).to.equal('D360_ECA_CREATE_FAILED');
    expect((error as Error).message).to.not.include('credentialed proxy details');
  });

  it('uses custom app name and contact email flags', async () => {
    const org = new MockTestOrgData('setup-eca-custom');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'retrieveMaxApiVersion').resolves('67.0');

    const fetchStub = commandTest.context.SANDBOX.stub(globalThis, 'fetch');

    // All steps succeed
    fetchStub
      .onFirstCall()
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><createMetadataResponse><result><success>true</success><fullName>MyApp</fullName></result></createMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );
    fetchStub
      .onSecondCall()
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><createMetadataResponse><result><success>true</success><fullName>MyApp_oauth</fullName></result></createMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );
    fetchStub
      .onThirdCall()
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><createMetadataResponse><result><success>true</success><fullName>MyApp_glbloauth</fullName></result></createMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );
    fetchStub
      .onCall(3)
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><readMetadataResponse><result><records><fullName>MyApp_glbloauth</fullName><consumerKey>CUSTOM_KEY</consumerKey></records></result></readMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );

    const result = await SetupEca.run([
      '--target-org',
      org.username,
      '--app-name',
      'MyApp',
      '--contact-email',
      'team@example.com',
      '--no-prompt',
      '--json',
    ]);

    expect(result.appName).to.equal('MyApp');
    expect(result.consumerKey).to.equal('CUSTOM_KEY');
    expect(result.created).to.equal(true);

    // Verify the first SOAP body includes the custom app name and email
    const firstBody = fetchStub.getCall(0).args[1]?.body as string;
    expect(firstBody).to.include('MyApp');
    expect(firstBody).to.include('team@example.com');
  });

  it('returns null consumer key when readMetadata does not contain one', async () => {
    const org = new MockTestOrgData('setup-eca-no-key');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'retrieveMaxApiVersion').resolves('67.0');

    const fetchStub = commandTest.context.SANDBOX.stub(globalThis, 'fetch');

    fetchStub
      .onFirstCall()
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><createMetadataResponse><result><success>true</success><fullName>D360CLI</fullName></result></createMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );
    fetchStub
      .onSecondCall()
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><createMetadataResponse><result><success>true</success><fullName>D360CLI_oauth</fullName></result></createMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );
    fetchStub
      .onThirdCall()
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><createMetadataResponse><result><success>true</success><fullName>D360CLI_glbloauth</fullName></result></createMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );
    // readMetadata returns a record without consumerKey
    fetchStub
      .onCall(3)
      .resolves(
        new Response(
          '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><readMetadataResponse><result><records><fullName>D360CLI_glbloauth</fullName></records></result></readMetadataResponse></soapenv:Body></soapenv:Envelope>',
          { status: 200, headers: { 'content-type': 'text/xml' } }
        )
      );

    const result = await SetupEca.run(['--target-org', org.username, '--no-prompt', '--json']);

    expect(result.consumerKey).to.equal(null);
    expect(result.reauthorizeCommand).to.include('<consumer-key>');
  });
});
