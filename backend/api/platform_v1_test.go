package api

import (
	"crypto/sha256"
	"fmt"
	"os"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"

	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	wire "github.com/sk1fy/amocrm-pro-admin/internal/platformwire"
)

func TestPinnedPlatformContract(t *testing.T) {
	const wantHash = "78f2ce5efd5e842cf5fcf2f431a6a1376439bbba8561c9ca72ed1cb0a917dbf7"
	body, err := os.ReadFile("platform-v1-openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if got := fmt.Sprintf("%x", sha256.Sum256(body)); got != wantHash {
		t.Fatalf("Platform schema hash = %s, want P01 %s", got, wantHash)
	}
	doc, err := openapi3.NewLoader().LoadFromData(body)
	if err != nil {
		t.Fatal(err)
	}
	if err := doc.Validate(t.Context()); err != nil {
		t.Fatal(err)
	}
	platformGrants := doc.Components.Schemas["Grant"].Value.Enum
	adminGrants := auth.ManagerAdminGrants()
	if len(platformGrants) != len(adminGrants) {
		t.Fatalf("Platform grants = %v, Admin grants = %v", platformGrants, adminGrants)
	}
	for i, grant := range adminGrants {
		if string(grant) != platformGrants[i] || !wire.Grant(grant).Valid() {
			t.Errorf("Admin grant %q does not match Platform grant %q", grant, platformGrants[i])
		}
	}
}
