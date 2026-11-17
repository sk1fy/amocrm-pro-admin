package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/sk1fy/amocrm-pro-admin/internal/managerplatform"
)

func TestManagerProductErrorsRemainDefinitive(t *testing.T) {
	for _, test := range []struct {
		code   string
		status int
	}{
		{code: "product_exists", status: http.StatusConflict},
		{code: "trial_policy_incompatible", status: http.StatusUnprocessableEntity},
		{code: "trial_evidence_required", status: http.StatusUnprocessableEntity},
		{code: "tariff_evidence_required", status: http.StatusUnprocessableEntity},
		{code: "integration_mapping_mismatch", status: http.StatusUnprocessableEntity},
	} {
		t.Run(test.code, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/v1/managers/products", nil)
			writeManagerAccountPeerError(response, request, &managerplatform.PeerError{
				Status: test.status, Code: test.code,
			})
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.status, response.Body.String())
			}
			var body struct {
				Error struct {
					Details struct {
						Code string `json:"code"`
					} `json:"details"`
				} `json:"error"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Error.Details.Code != test.code {
				t.Fatalf("public reason = %q, want %q", body.Error.Details.Code, test.code)
			}
		})
	}
}
