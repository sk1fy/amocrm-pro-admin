package accounts

import (
	"strconv"
	"testing"
)

func TestNormalizeQuery(t *testing.T) {
	id := func(v int64) *int64 { return &v }
	tests := []struct {
		in        string
		accountID *int64
		domain    string
		subdomain string
		coreQ     string
	}{
		{in: "", coreQ: ""},
		{in: "31415926", accountID: id(31415926), coreQ: "31415926"},
		{in: "  31415926  ", accountID: id(31415926), coreQ: "31415926"},
		{in: "fixture-one", subdomain: "fixture-one", coreQ: "fixture-one"},
		{in: "fixture-one.amocrm.test", domain: "fixture-one.amocrm.test", coreQ: "fixture-one.amocrm.test"},
		{
			in:     "https://fixture-one.amocrm.ru/leads/detail/123",
			domain: "fixture-one.amocrm.ru",
			coreQ:  "fixture-one.amocrm.ru",
		},
		{in: "https://example.kommo.com/leads", domain: "example.kommo.com", coreQ: "example.kommo.com"},
		{in: "   ", coreQ: ""},
	}
	for _, test := range tests {
		got := NormalizeQuery(test.in)
		var accountID *int64
		if got.AccountID != nil {
			value := *got.AccountID
			accountID = &value
		}
		if ptrInt(accountID) != ptrInt(test.accountID) || got.Domain != test.domain || got.Subdomain != test.subdomain {
			t.Fatalf("q=%q got id=%s domain=%q subdomain=%q", test.in, formatID(got.AccountID), got.Domain, got.Subdomain)
		}
		if got.CoreQ() != test.coreQ {
			t.Fatalf("q=%q CoreQ=%q want %q", test.in, got.CoreQ(), test.coreQ)
		}
	}
}

func ptrInt(v *int64) int64 {
	if v == nil {
		return 0
	}
	return *v
}

func formatID(v *int64) string {
	if v == nil {
		return "<nil>"
	}
	return strconv.FormatInt(*v, 10)
}
