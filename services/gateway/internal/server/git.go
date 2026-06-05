package server

import (
	"context"
	"io"

	gatewayv1 "github.com/filipgorny/ai-architect/proto/gateway/v1"
	gitv1 "github.com/filipgorny/ai-architect/proto/git/v1"
)

// --- Proxy gita: gateway → serwis git (autorstwo + diff-review) ---

// UploadRepo pompuje strumień kawałków .git od Electrona do serwisu git i zwraca
// jego podsumowanie (Electron „wysyła" .git otwartego projektu tutaj).
func (p *Proxy) UploadRepo(in gatewayv1.Gateway_UploadRepoServer) error {
	out, err := p.git.UploadRepo(in.Context())

	if err != nil {
		return err
	}

	for {
		chunk, rerr := in.Recv()

		if rerr == io.EOF {
			break
		}

		if rerr != nil {
			return rerr
		}

		if serr := out.Send(&gitv1.RepoChunk{
			RepoPath: chunk.GetRepoPath(),
			RelPath:  chunk.GetRelPath(),
			Data:     chunk.GetData(),
			Eof:      chunk.GetEof(),
		}); serr != nil {
			return serr
		}
	}

	res, err := out.CloseAndRecv()

	if err != nil {
		return err
	}

	return in.SendAndClose(&gatewayv1.GitUploadResult{
		RepoPath:   res.GetRepoPath(),
		Ok:         res.GetOk(),
		Files:      res.GetFiles(),
		HeadBranch: res.GetHeadBranch(),
	})
}

func (p *Proxy) GitFileInfo(ctx context.Context, req *gatewayv1.GitFileInfoRequest) (*gatewayv1.GitFileInfoResponse, error) {
	resp, err := p.git.FileInfo(ctx, &gitv1.FileInfoRequest{RepoPath: req.GetRepoPath(), File: req.GetFile()})

	if err != nil {
		return nil, err
	}

	return &gatewayv1.GitFileInfoResponse{
		Tracked:         resp.GetTracked(),
		LastAuthor:      resp.GetLastAuthor(),
		LastAuthorEmail: resp.GetLastAuthorEmail(),
		LastCommitHash:  resp.GetLastCommitHash(),
		LastCommitTime:  resp.GetLastCommitTime(),
		LastMessage:     resp.GetLastMessage(),
	}, nil
}

func (p *Proxy) GitReviewStatus(ctx context.Context, req *gatewayv1.GitReviewRequest) (*gatewayv1.GitReviewResponse, error) {
	resp, err := p.git.ReviewStatus(ctx, &gitv1.ReviewRequest{RepoPath: req.GetRepoPath(), Base: req.GetBase()})

	if err != nil {
		return nil, err
	}

	out := &gatewayv1.GitReviewResponse{Base: resp.GetBase(), Head: resp.GetHead()}

	for _, f := range resp.GetFiles() {
		out.Files = append(out.Files, &gatewayv1.GitChangedFile{
			Path:    f.GetPath(),
			AbsPath: f.GetAbsPath(),
			Status:  f.GetStatus(),
		})
	}

	return out, nil
}

func (p *Proxy) GitFileDiff(ctx context.Context, req *gatewayv1.GitFileDiffRequest) (*gatewayv1.GitFileDiffResponse, error) {
	resp, err := p.git.FileDiff(ctx, &gitv1.FileDiffRequest{
		RepoPath: req.GetRepoPath(),
		File:     req.GetFile(),
		Base:     req.GetBase(),
	})

	if err != nil {
		return nil, err
	}

	return &gatewayv1.GitFileDiffResponse{
		Status:        resp.GetStatus(),
		AddedLines:    resp.GetAddedLines(),
		ModifiedLines: resp.GetModifiedLines(),
	}, nil
}
