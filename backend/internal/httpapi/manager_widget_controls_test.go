package httpapi

import (
	"github.com/google/uuid"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"testing"
)

func TestWidgetTechnicalControlsUseEmployeeID(t *testing.T) {
	for _, tc := range []struct {
		id   string
		want bool
	}{
		{"b83eda76-174d-4950-92d6-270b61ff6d36", true},
		{"00000001-0000-4000-8000-000000000001", false},
	} {
		profile := toManagerMeDTO(auth.Account{ID: uuid.MustParse(tc.id), Name: "Nikita"})
		if profile.WidgetTechnicalControls != tc.want {
			t.Errorf("widget controls for %s = %t, want %t", tc.id, profile.WidgetTechnicalControls, tc.want)
		}
	}
}
