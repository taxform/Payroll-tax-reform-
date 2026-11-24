-- Disposable PostgreSQL integration checks for consent constraints.
-- Run as schema owner after applying the draft migration. Synthetic UUIDs only.
INSERT INTO payrollcheck.tenants(tenant_id,tenant_type) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','business'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','accounting_firm');
INSERT INTO payrollcheck.client_grants(
 grant_id,firm_tenant_id,business_tenant_id,scopes,status,
 requested_by_subject,approved_by_subject,approved_at
) VALUES (
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 ARRAY['view_report'],'active','requester1','owner1',now()
);
DO $$
BEGIN
 -- An active firm/business pair must be unique.
 BEGIN
  INSERT INTO payrollcheck.client_grants(
   grant_id,firm_tenant_id,business_tenant_id,scopes,status,
   requested_by_subject,approved_by_subject,approved_at
  ) VALUES (
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   ARRAY['view_report'],'active','requester2','owner2',now()
  );
  RAISE EXCEPTION 'duplicate active consent unexpectedly accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 -- Duplicate permission scopes must fail the database CHECK.
 BEGIN
  INSERT INTO payrollcheck.client_grants(
   grant_id,firm_tenant_id,business_tenant_id,scopes,status,requested_by_subject
  ) VALUES (
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   ARRAY['view_report','view_report'],'pending','requester3'
  );
  RAISE EXCEPTION 'duplicate scopes unexpectedly accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 -- Active consent without business approval must fail.
 BEGIN
  INSERT INTO payrollcheck.client_grants(
   grant_id,firm_tenant_id,business_tenant_id,scopes,status,requested_by_subject
  ) VALUES (
   'ffffffff-ffff-4fff-8fff-ffffffffffff',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   ARRAY['review_finding'],'active','requester4'
  );
  RAISE EXCEPTION 'unapproved active consent unexpectedly accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;

-- Revocation must invalidate the active-grant query and allow a new approval.
UPDATE payrollcheck.client_grants
 SET status='revoked',revoked_by_subject='owner1',revoked_at=now()
 WHERE grant_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
DO $$
DECLARE n bigint;
BEGIN
 SELECT count(*) INTO n FROM payrollcheck.client_grants
 WHERE firm_tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
 AND business_tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 AND status='active';
 IF n<>0 THEN RAISE EXCEPTION 'revoked consent remains active'; END IF;
END $$;
INSERT INTO payrollcheck.client_grants(
 grant_id,firm_tenant_id,business_tenant_id,scopes,status,
 requested_by_subject,approved_by_subject,approved_at
) VALUES (
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 ARRAY['review_finding'],'active','requester2','owner2',now()
);
DO $$
DECLARE n bigint;
BEGIN
 SELECT count(*) INTO n FROM payrollcheck.client_grants
 WHERE firm_tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
 AND business_tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 AND status='active';
 IF n<>1 THEN RAISE EXCEPTION 'reapproved consent not uniquely active'; END IF;
END $$;
