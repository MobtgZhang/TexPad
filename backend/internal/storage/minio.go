package storage

import (
	"context"
	"fmt"
	"io"
	"path"
	"strings"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Client struct {
	bucket string
	inner  *minio.Client
}

func New(endpoint, access, secret string, useSSL bool, bucket string) (*Client, error) {
	cli, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(access, secret, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, err
	}
	return &Client{bucket: bucket, inner: cli}, nil
}

func (c *Client) EnsureBucket(ctx context.Context) error {
	exists, err := c.inner.BucketExists(ctx, c.bucket)
	if err != nil {
		return err
	}
	if !exists {
		return c.inner.MakeBucket(ctx, c.bucket, minio.MakeBucketOptions{})
	}
	return nil
}

func fileObjectKey(projectID uuid.UUID, relPath string) string {
	rel := strings.TrimPrefix(path.Clean(relPath), "/")
	return fmt.Sprintf("projects/%s/files/%s", projectID.String(), rel)
}

func SnapshotObjectKey(projectID, snapshotID uuid.UUID, relPath string) string {
	rel := strings.TrimPrefix(path.Clean(relPath), "/")
	return fmt.Sprintf("projects/%s/snapshots/%s/%s", projectID.String(), snapshotID.String(), rel)
}

func ProjectFileKey(projectID uuid.UUID, relPath string) string {
	return fileObjectKey(projectID, relPath)
}

func (c *Client) PutFile(ctx context.Context, projectID uuid.UUID, relPath string, r io.Reader, size int64, contentType string) error {
	opts := minio.PutObjectOptions{}
	if contentType != "" {
		opts.ContentType = contentType
	}
	_, err := c.inner.PutObject(ctx, c.bucket, fileObjectKey(projectID, relPath), r, size, opts)
	return err
}

func (c *Client) GetFile(ctx context.Context, projectID uuid.UUID, relPath string) (*minio.Object, error) {
	return c.inner.GetObject(ctx, c.bucket, fileObjectKey(projectID, relPath), minio.GetObjectOptions{})
}

func (c *Client) RemoveFile(ctx context.Context, projectID uuid.UUID, relPath string) error {
	return c.inner.RemoveObject(ctx, c.bucket, fileObjectKey(projectID, relPath), minio.RemoveObjectOptions{})
}

func (c *Client) PresignedGet(ctx context.Context, objectKey string) (string, error) {
	u, err := c.inner.PresignedGetObject(ctx, c.bucket, objectKey, 3600, nil)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

func ArtifactPDFKey(projectID, jobID uuid.UUID) string {
	return fmt.Sprintf("projects/%s/artifacts/%s/output.pdf", projectID.String(), jobID.String())
}

func ArtifactSynctexKey(projectID, jobID uuid.UUID) string {
	return fmt.Sprintf("projects/%s/artifacts/%s/output.synctex.gz", projectID.String(), jobID.String())
}

func (c *Client) PutArtifact(ctx context.Context, objectKey string, r io.Reader, size int64) error {
	_, err := c.inner.PutObject(ctx, c.bucket, objectKey, r, size, minio.PutObjectOptions{ContentType: "application/pdf"})
	return err
}

func (c *Client) PutArtifactTyped(ctx context.Context, objectKey string, r io.Reader, size int64, contentType string) error {
	opts := minio.PutObjectOptions{}
	if contentType != "" {
		opts.ContentType = contentType
	}
	_, err := c.inner.PutObject(ctx, c.bucket, objectKey, r, size, opts)
	return err
}

func (c *Client) GetObject(ctx context.Context, key string) (*minio.Object, error) {
	return c.inner.GetObject(ctx, c.bucket, key, minio.GetObjectOptions{})
}

func (c *Client) CopyObject(ctx context.Context, srcKey, dstKey string) error {
	src := minio.CopySrcOptions{Bucket: c.bucket, Object: srcKey}
	dst := minio.CopyDestOptions{Bucket: c.bucket, Object: dstKey}
	_, err := c.inner.CopyObject(ctx, dst, src)
	return err
}

// RemoveSnapshotTree deletes all objects under projects/{projectID}/snapshots/{snapshotID}/.
func (c *Client) RemoveSnapshotTree(ctx context.Context, projectID, snapshotID uuid.UUID) error {
	prefix := fmt.Sprintf("projects/%s/snapshots/%s/", projectID.String(), snapshotID.String())
	opts := minio.ListObjectsOptions{Prefix: prefix, Recursive: true}
	for obj := range c.inner.ListObjects(ctx, c.bucket, opts) {
		if obj.Err != nil {
			return obj.Err
		}
		if err := c.inner.RemoveObject(ctx, c.bucket, obj.Key, minio.RemoveObjectOptions{}); err != nil {
			return err
		}
	}
	return nil
}
