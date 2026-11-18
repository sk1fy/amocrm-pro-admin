package api

import (
	_ "embed"

	"github.com/getkin/kin-openapi/openapi3"
)

//go:embed platform-v1-openapi.yaml
var platformContract []byte

func LoadPlatformContract() (*openapi3.T, error) {
	return openapi3.NewLoader().LoadFromData(platformContract)
}
